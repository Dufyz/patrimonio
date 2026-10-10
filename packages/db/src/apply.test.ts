import {
  NotFoundError,
  applyPlan,
  closeDay,
  createDebouncePolicy,
  planAlertReconciliation,
  recalculatePortfolio,
} from '@patrimonio/application';
import type { Clock, UnitOfWork } from '@patrimonio/application';
import { dedupeKey } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { closeDatabase } from './postgresql.js';
import type { Sql } from './postgresql.js';
import { createTestConnection, prepareTestDatabase } from './testing/database.js';
import { createRepositories, createUnitOfWork } from './unit-of-work.js';

/**
 * `apply` contra Postgres real. Mock de banco provaria que o código chama o método
 * certo; o que precisa ser provado é que a transação desfaz, que a trava serializa
 * e que a projeção não fica pela metade — e nada disso aparece num mock.
 *
 * Estes testes comitam de propósito, porque o que se mede é o comportamento de
 * transações concorrentes. A limpeza é explícita no `afterEach`.
 */
const PORTFOLIO = '0191e5a0-0000-7000-8000-00000000c001';
const INSTITUTION = '0191e5a0-0000-7000-8000-00000000d001';
const ASSET = '0191e5a0-0000-7000-8000-00000000e001';
const TRANSACTION = '0191e5a0-0000-7000-8000-00000000f001';

let sql: Sql;
let unitOfWork: UnitOfWork;

const clock: Clock = { now: () => new Date(), today: () => '2026-10-06' };

const seed = async (): Promise<void> => {
  await sql`
    INSERT INTO institution (id, name)
    VALUES (${INSTITUTION}, 'Corretora E3')
  `;
  await sql`
    INSERT INTO portfolio (id, name) VALUES (${PORTFOLIO}, 'Carteira E3')
  `;
  await sql`
    INSERT INTO asset (id, ticker, name, origin, b3_type)
    VALUES (${ASSET}, 'E3TEST3', 'Ativo de teste', 'market', 'stock')
  `;
  await sql`
    INSERT INTO transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id, institution_id,
       quantity, unit_price, fees, gross_amount, net_amount)
    VALUES (${TRANSACTION}, 'buy', '2026-10-01', '2026-10-05', ${PORTFOLIO}, ${ASSET},
            ${INSTITUTION}, 100, 30, 0, 3000, -3000)
  `;
};

const cleanup = async (): Promise<void> => {
  await sql`DELETE FROM alert_instance WHERE subject_id LIKE 'e3-%'`;
  await sql`DELETE FROM alert_rule WHERE kind LIKE 'e3_%'`;
  await sql`DELETE FROM pipeline_outbox`;
  await sql`DELETE FROM position_daily WHERE portfolio_id = ${PORTFOLIO}`;
  await sql`DELETE FROM portfolio_daily WHERE portfolio_id = ${PORTFOLIO}`;
  await sql`DELETE FROM realized_result WHERE portfolio_id = ${PORTFOLIO}`;
  await sql`DELETE FROM transaction WHERE portfolio_id = ${PORTFOLIO}`;
  await sql`DELETE FROM portfolio WHERE id = ${PORTFOLIO}`;
  await sql`DELETE FROM asset WHERE id = ${ASSET}`;
  await sql`DELETE FROM institution WHERE id = ${INSTITUTION}`;
};

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
  unitOfWork = createUnitOfWork(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

afterEach(cleanup);

describe('atomicidade', () => {
  it('uma falha no meio não deixa projeção parcial', async () => {
    await seed();

    const result = await unitOfWork.run(async (repositories) => {
      const written = await applyPlan(repositories, {
        stage: 'recalc',
        outcome: 'succeeded',
        portfolio_id: PORTFOLIO,
        reference_date: '2026-10-06',
        from_date: '2026-10-01',
        projection: {
          delete_from: '2026-10-01',
          positions: [
            {
              portfolio_id: PORTFOLIO,
              asset_id: ASSET,
              position_date: '2026-10-01',
              quantity: '100.00000000',
              avg_price: '30.00000000',
              cost_basis: '3000.00',
              market_value: '3000.00',
              price_source_kind: 'missing',
              accrued_interest: '0.00',
            },
          ],
          portfolio_days: [
            {
              portfolio_id: PORTFOLIO,
              position_date: '2026-10-01',
              total_value: '3000.00',
              net_flow: '3000.00',
              income: '0.00',
              payouts: '0.00',
              quota_value: '1.000000000000',
              quota_count: '3000.000000000000',
              cumulative_contributions: '3000.00',
            },
          ],
        },
      });
      if (written.isFailure()) return written;

      // Depois de a projeção ter sido escrita, o trabalho falha. Nada pode ficar:
      // nem a linha de projeção, nem o evento que a transição pediu.
      return failure(new NotFoundError('carteira sumiu no meio do recálculo'));
    });

    expect(result.isFailure()).toBe(true);

    const [positions] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM position_daily WHERE portfolio_id = ${PORTFOLIO}
    `;
    const [events] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM pipeline_outbox
    `;

    expect(positions?.total).toBe('0');
    // O evento morre junto com o estado que o originou: abortar não deixa órfão.
    expect(events?.total).toBe('0');
  });

  it('o evento da transição é gravado na mesma transação do estado', async () => {
    await seed();

    unwrapSuccess(
      await unitOfWork.run(async (repositories) =>
        applyPlan(repositories, {
          stage: 'recalc',
          outcome: 'succeeded',
          portfolio_id: PORTFOLIO,
          reference_date: '2026-10-06',
          from_date: '2026-10-01',
        }),
      ),
    );

    const rows = await sql<{ stage: string; dedupe_key: string }[]>`
      SELECT stage, dedupe_key FROM pipeline_outbox
    `;

    // Recálculo concluído pede a reconciliação de alertas, para o painel refletir
    // o número novo.
    expect(rows).toEqual([
      { stage: 'alerts', dedupe_key: dedupeKey.alerts('2026-10-06') },
    ]);
  });

  it('recalc_status é escrito pela transição, e por mais ninguém', async () => {
    await seed();

    unwrapSuccess(
      await unitOfWork.run(async (repositories) =>
        applyPlan(repositories, {
          stage: 'recalc',
          outcome: 'failed',
          recoverable: false,
          portfolio_id: PORTFOLIO,
          reference_date: '2026-10-06',
          from_date: '2026-10-01',
          error: 'provedor fora do ar',
        }),
      ),
    );

    const [row] = await sql<{ recalc_status: string; recalc_error: string | null }[]>`
      SELECT recalc_status, recalc_error FROM portfolio WHERE id = ${PORTFOLIO}
    `;

    expect(row?.recalc_status).toBe('failed');
    expect(row?.recalc_error).toBe('provedor fora do ar');
  });
});

describe('trava por carteira', () => {
  it('dois apply em paralelo sobre a mesma carteira serializam', async () => {
    await seed();

    const order: string[] = [];

    /**
     * O atraso injetado entre a leitura e a escrita é o que reproduz o cenário
     * real: o usuário salva um lançamento enquanto o fechamento diário roda. Sem
     * ele, as duas transações terminariam rápido demais para se cruzarem.
     */
    const run = (label: string, delayMs: number) =>
      unitOfWork.run(
        async (repositories) => {
          order.push(`${label}:leu`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));

          const written = await applyPlan(repositories, {
            stage: 'recalc',
            outcome: 'succeeded',
            portfolio_id: PORTFOLIO,
            reference_date: '2026-10-06',
            from_date: '2026-10-01',
            projection: {
              delete_from: '2026-10-01',
              positions: [],
              portfolio_days: [
                {
                  portfolio_id: PORTFOLIO,
                  position_date: '2026-10-01',
                  total_value: label === 'a' ? '1000.00' : '2000.00',
                  net_flow: '0.00',
                  income: '0.00',
                  payouts: '0.00',
                  quota_value: '1.000000000000',
                  quota_count: label === 'a' ? '1000.000000000000' : '2000.000000000000',
                  cumulative_contributions: '0.00',
                },
              ],
            },
          });
          if (written.isFailure()) return written;

          order.push(`${label}:escreveu`);
          return success(label);
        },
        { lock: `portfolio:${PORTFOLIO}` },
      );

    await Promise.all([run('a', 120), run('b', 0)]);

    // Serializadas: nenhuma leu no meio da escrita da outra.
    expect(order).toHaveLength(4);
    const first = order[0]?.split(':')[0];
    expect(order[1]).toBe(`${first ?? ''}:escreveu`);

    // E só uma linha ficou, com o valor de quem escreveu por último.
    const rows = await sql<{ total_value: string }[]>`
      SELECT total_value FROM portfolio_daily WHERE portfolio_id = ${PORTFOLIO}
    `;
    expect(rows).toHaveLength(1);
  });
});

describe('idempotência do recálculo', () => {
  it('rodar o recálculo duas vezes para o mesmo intervalo produz o mesmo estado', async () => {
    await seed();

    const usecase = recalculatePortfolio({ unitOfWork, clock });

    unwrapSuccess(await usecase({ portfolio_id: PORTFOLIO, from_date: '2026-10-01' }));
    const first = await sql<Record<string, unknown>[]>`
      SELECT portfolio_id, position_date, total_value, net_flow, income, payouts,
             quota_value, quota_count, cumulative_contributions
        FROM portfolio_daily WHERE portfolio_id = ${PORTFOLIO} ORDER BY position_date
    `;

    unwrapSuccess(await usecase({ portfolio_id: PORTFOLIO, from_date: '2026-10-01' }));
    const second = await sql<Record<string, unknown>[]>`
      SELECT portfolio_id, position_date, total_value, net_flow, income, payouts,
             quota_value, quota_count, cumulative_contributions
        FROM portfolio_daily WHERE portfolio_id = ${PORTFOLIO} ORDER BY position_date
    `;

    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('o fechamento do mesmo dia duas vezes produz exatamente as mesmas linhas', async () => {
    await seed();

    const usecase = closeDay({ unitOfWork, clock });

    unwrapSuccess(await usecase({ reference_date: '2026-10-06' }));
    const first = await sql<Record<string, unknown>[]>`
      SELECT asset_id, quantity, market_value, price_source_kind
        FROM position_daily
       WHERE portfolio_id = ${PORTFOLIO} AND position_date = '2026-10-06'
       ORDER BY asset_id
    `;

    unwrapSuccess(await usecase({ reference_date: '2026-10-06' }));
    const second = await sql<Record<string, unknown>[]>`
      SELECT asset_id, quantity, market_value, price_source_kind
        FROM position_daily
       WHERE portfolio_id = ${PORTFOLIO} AND position_date = '2026-10-06'
       ORDER BY asset_id
    `;

    expect(second).toEqual(first);
  });

  it('a carteira sem lançamento nenhum não é erro: não há o que reconstruir', async () => {
    await sql`INSERT INTO portfolio (id, name) VALUES (${PORTFOLIO}, 'Carteira vazia')`;

    const result = unwrapSuccess(
      await recalculatePortfolio({ unitOfWork, clock })({
        portfolio_id: PORTFOLIO,
        from_date: '2026-10-01',
      }),
    );

    expect(result.report).toBeNull();
  });
});

describe('coalescência e espera', () => {
  const draft = (fromDate: string) => ({
    stage: 'recalc' as const,
    dedupe_key: dedupeKey.recalc(PORTFOLIO),
    payload: { portfolio_id: PORTFOLIO, from_date: fromDate },
  });

  it('cinco pedidos seguidos na mesma carteira produzem um recálculo', async () => {
    const repositories = createRepositories(sql);

    for (const date of [
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]) {
      unwrapSuccess(await repositories.outbox.enqueue([draft(date)]));
    }

    const rows = await sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM pipeline_outbox WHERE dispatched_at IS NULL
    `;

    expect(rows[0]?.total).toBe('1');
  });

  it('o from_date do pendente recua para a data mais antiga pedida', async () => {
    const repositories = createRepositories(sql);

    unwrapSuccess(await repositories.outbox.enqueue([draft('2026-10-05')]));
    unwrapSuccess(await repositories.outbox.enqueue([draft('2015-03-12')]));
    unwrapSuccess(await repositories.outbox.enqueue([draft('2026-10-06')]));

    const [row] = await sql<{ from_date: string }[]>`
      SELECT payload ->> 'from_date' AS from_date FROM pipeline_outbox
    `;

    // Editar um lançamento de 2015 no meio da rajada reescreve dez anos, e o
    // pedido pendente precisa saber disso.
    expect(row?.from_date).toBe('2015-03-12');
  });

  it('a rajada empurra a espera, até o teto contado do primeiro pedido', async () => {
    let now = new Date('2026-10-06T12:00:00.000Z');
    const debounce = createDebouncePolicy({ waitMs: 5_000, maxMs: 8_000 }, () => now);
    const repositories = createRepositories(sql, { debounce });

    unwrapSuccess(await repositories.outbox.enqueue([draft('2026-10-01')]));

    const [first] = await sql<{ available_at: Date; debounce_until: Date }[]>`
      SELECT available_at, debounce_until FROM pipeline_outbox
    `;

    now = new Date('2026-10-06T12:00:04.000Z');
    unwrapSuccess(await repositories.outbox.enqueue([draft('2026-10-02')]));

    const [second] = await sql<{ available_at: Date; debounce_until: Date }[]>`
      SELECT available_at, debounce_until FROM pipeline_outbox
    `;

    // O segundo pedido empurra a espera.
    expect(second?.available_at.getTime()).toBeGreaterThan(
      first?.available_at.getTime() ?? 0,
    );
    // E ela nunca passa do teto calculado no primeiro: alguém lançando sem parar
    // não adia o recálculo para sempre.
    expect(second?.available_at.getTime()).toBeLessThanOrEqual(
      first?.debounce_until.getTime() ?? 0,
    );
  });

  it('o pedido de fechamento não espera: ele já tem hora', async () => {
    const debounce = createDebouncePolicy(
      { waitMs: 60_000, maxMs: 120_000 },
      () => new Date('2026-10-06T12:00:00.000Z'),
    );
    const repositories = createRepositories(sql, { debounce });

    unwrapSuccess(
      await repositories.outbox.enqueue([
        {
          stage: 'close',
          dedupe_key: dedupeKey.close('2026-10-06'),
          payload: { reference_date: '2026-10-06' },
        },
      ]),
    );

    const [row] = await sql<{ available_at: Date; debounce_until: Date | null }[]>`
      SELECT available_at, debounce_until FROM pipeline_outbox
    `;

    expect(row?.debounce_until).toBeNull();
    expect(row?.available_at.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
  });
});

describe('reconciliação de alertas', () => {
  const RULE = 'e3_preco_atrasado';

  const seedAlert = async (status: string, snoozeUntil: string | null): Promise<void> => {
    await sql`
      INSERT INTO alert_rule (kind, enabled, scope) VALUES (${RULE}, TRUE, 'global')
    `;
    await sql`
      INSERT INTO alert_instance (rule_kind, subject_id, status, snooze_until, payload)
      VALUES (${RULE}, 'e3-itub4', ${status}::alert_status, ${snoozeUntil},
              '{"dias": 3}'::JSONB)
    `;
  };

  it('alerta adiado continua adiado depois do recálculo', async () => {
    await seedAlert('snoozed', '2026-12-01');

    const repositories = createRepositories(sql);
    const existing = unwrapSuccess(
      await repositories.alerts.listForRules({ rule_kinds: [RULE] }),
    );

    const plan = planAlertReconciliation({
      existing,
      findings: [
        {
          rule_kind: RULE,
          subject_id: 'e3-itub4',
          portfolio_id: null,
          payload: { dias: 9 },
        },
      ],
    });

    unwrapSuccess(
      await repositories.alerts.applyReconciliation(plan.upserts, plan.resolved),
    );

    const [row] = await sql<
      { status: string; snooze_until: string; payload: { dias: number } }[]
    >`
      SELECT status, snooze_until, payload FROM alert_instance WHERE rule_kind = ${RULE}
    `;

    expect(row?.status).toBe('snoozed');
    expect(row?.snooze_until).toBe('2026-12-01');
    // O texto é do motor e foi atualizado; a decisão é do usuário e ficou.
    expect(row?.payload.dias).toBe(9);
  });

  it('alerta ignorado não reaparece para o mesmo item', async () => {
    await seedAlert('ignored', null);

    const repositories = createRepositories(sql);
    const existing = unwrapSuccess(
      await repositories.alerts.listForRules({ rule_kinds: [RULE] }),
    );

    const plan = planAlertReconciliation({
      existing,
      findings: [
        { rule_kind: RULE, subject_id: 'e3-itub4', portfolio_id: null, payload: {} },
      ],
    });

    unwrapSuccess(
      await repositories.alerts.applyReconciliation(plan.upserts, plan.resolved),
    );

    const active = unwrapSuccess(
      await repositories.alerts.listActive({ on_date: '2026-10-06' }),
    );

    expect(active.filter((alert) => alert.rule_kind === RULE)).toEqual([]);
  });

  it('o que deixou de valer sai, e o primeiro avistamento do que fica não muda', async () => {
    await seedAlert('open', null);

    const repositories = createRepositories(sql);
    const [before] = await sql<{ first_seen_at: Date }[]>`
      SELECT first_seen_at FROM alert_instance WHERE rule_kind = ${RULE}
    `;

    const existing = unwrapSuccess(
      await repositories.alerts.listForRules({ rule_kinds: [RULE] }),
    );

    const kept = planAlertReconciliation({
      existing,
      findings: [
        {
          rule_kind: RULE,
          subject_id: 'e3-itub4',
          portfolio_id: null,
          payload: { dias: 4 },
        },
      ],
    });
    unwrapSuccess(
      await repositories.alerts.applyReconciliation(kept.upserts, kept.resolved),
    );

    const [after] = await sql<{ first_seen_at: Date }[]>`
      SELECT first_seen_at FROM alert_instance WHERE rule_kind = ${RULE}
    `;

    // O alerta que aparece todo dia desde março continua dizendo março.
    expect(after?.first_seen_at.toISOString()).toBe(before?.first_seen_at.toISOString());

    const gone = planAlertReconciliation({ existing, findings: [] });
    unwrapSuccess(
      await repositories.alerts.applyReconciliation(gone.upserts, gone.resolved),
    );

    const [total] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM alert_instance WHERE rule_kind = ${RULE}
    `;
    expect(total?.total).toBe('0');
  });
});

/**
 * A invariante central do modelo, medida contra o banco: reconstruir do zero
 * produz o mesmo estado que o cálculo incremental. Se ela falha, alguma projeção
 * guarda informação que não está no livro — e aí o backup não é suficiente, o
 * histórico não é corrigível, e o princípio de produto cai.
 *
 * Os testes de propriedade em `calc` provam a mesma coisa sobre a série em
 * memória. Este prova sobre o caminho inteiro: fechamento dia a dia, truncar as
 * projeções, recalcular de uma vez, comparar linha a linha.
 */
describe('do zero é igual ao incremental, contra o banco', () => {
  const DAYS = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06'] as const;

  const SELL = '0191e5a0-0000-7000-8000-00000000f002';

  const seedWithHistory = async (): Promise<void> => {
    await seed();

    // Uma venda no meio: ela move preço médio, resultado realizado e caixa, que
    // são as três coisas que um recálculo parcial poderia deixar fora de sincronia.
    await sql`
      INSERT INTO transaction
        (id, kind, trade_date, settlement_date, portfolio_id, asset_id, institution_id,
         quantity, unit_price, fees, gross_amount, net_amount)
      VALUES (${SELL}, 'sell', '2026-10-05', '2026-10-07', ${PORTFOLIO}, ${ASSET},
              ${INSTITUTION}, 40, 31.5, 4.9, 1260, 1255.10)
    `;

    await sql`
      INSERT INTO asset_price (asset_id, price_date, close, source, source_kind)
      SELECT ${ASSET}::UUID, entry.price_date::DATE, entry.close::NUMERIC,
               'teste', 'primary'::price_source_kind
        FROM JSONB_TO_RECORDSET(${JSON.stringify([
          { price_date: '2026-10-01', close: '30.00' },
          { price_date: '2026-10-02', close: '31.00' },
          { price_date: '2026-10-05', close: '29.50' },
          { price_date: '2026-10-06', close: '32.00' },
        ])}::TEXT::JSONB) AS entry(price_date TEXT, close TEXT)
    `;
  };

  const snapshot = async (): Promise<{
    readonly positions: readonly Record<string, unknown>[];
    readonly days: readonly Record<string, unknown>[];
    readonly realized: readonly Record<string, unknown>[];
  }> => ({
    // `computed_at` fica fora da comparação: ele diz quando a linha foi gravada,
    // não o que ela vale, e é a única coluna que muda entre duas execuções iguais.
    positions: await sql<Record<string, unknown>[]>`
      SELECT asset_id, position_date, quantity, avg_price, cost_basis, market_value,
             price_source_kind, accrued_interest
        FROM position_daily WHERE portfolio_id = ${PORTFOLIO}
       ORDER BY position_date, asset_id
    `,
    days: await sql<Record<string, unknown>[]>`
      SELECT position_date, total_value, net_flow, income, payouts, quota_value,
             quota_count, cumulative_contributions
        FROM portfolio_daily WHERE portfolio_id = ${PORTFOLIO}
       ORDER BY position_date
    `,
    realized: await sql<Record<string, unknown>[]>`
      SELECT transaction_id, trade_date, proceeds, cost_consumed, result, exempt,
             loss_offset
        FROM realized_result WHERE portfolio_id = ${PORTFOLIO} ORDER BY trade_date
    `,
  });

  it('fechar dia a dia e reconstruir de uma vez dão o mesmo estado, linha a linha', async () => {
    await seedWithHistory();

    // Incremental: o fechamento de cada dia, na ordem, como acontece na vida real.
    const close = closeDay({ unitOfWork, clock });
    for (const date of DAYS) {
      unwrapSuccess(await close({ reference_date: date }));
    }

    const incremental = await snapshot();
    expect(incremental.days).toHaveLength(DAYS.length);
    expect(incremental.realized).toHaveLength(1);

    // Truncar a projeção e reconstruir do livro, de uma vez.
    await sql`DELETE FROM position_daily WHERE portfolio_id = ${PORTFOLIO}`;
    await sql`DELETE FROM portfolio_daily WHERE portfolio_id = ${PORTFOLIO}`;
    await sql`DELETE FROM realized_result WHERE portfolio_id = ${PORTFOLIO}`;

    unwrapSuccess(
      await recalculatePortfolio({ unitOfWork, clock })({
        portfolio_id: PORTFOLIO,
        from_date: '2026-10-01',
        through_date: '2026-10-06',
      }),
    );

    const rebuilt = await snapshot();

    expect(rebuilt.days).toEqual(incremental.days);
    expect(rebuilt.positions).toEqual(incremental.positions);
    expect(rebuilt.realized).toEqual(incremental.realized);
  });

  it('a projeção pode ser apagada e reconstruída sem perda', async () => {
    await seedWithHistory();

    const usecase = recalculatePortfolio({ unitOfWork, clock });

    unwrapSuccess(
      await usecase({
        portfolio_id: PORTFOLIO,
        from_date: '2026-10-01',
        through_date: '2026-10-06',
      }),
    );
    const first = await snapshot();

    await sql`DELETE FROM position_daily WHERE portfolio_id = ${PORTFOLIO}`;
    await sql`DELETE FROM portfolio_daily WHERE portfolio_id = ${PORTFOLIO}`;

    unwrapSuccess(
      await usecase({
        portfolio_id: PORTFOLIO,
        from_date: '2026-10-01',
        through_date: '2026-10-06',
      }),
    );

    expect((await snapshot()).days).toEqual(first.days);
    expect((await snapshot()).positions).toEqual(first.positions);
  });

  it('reconstruir só a ponta dá o mesmo resultado que reconstruir tudo', async () => {
    await seedWithHistory();

    const usecase = recalculatePortfolio({ unitOfWork, clock });

    unwrapSuccess(
      await usecase({
        portfolio_id: PORTFOLIO,
        from_date: '2026-10-01',
        through_date: '2026-10-06',
      }),
    );
    const whole = await snapshot();

    // Só os dois últimos dias, partindo da linha que ficou no banco.
    unwrapSuccess(
      await usecase({
        portfolio_id: PORTFOLIO,
        from_date: '2026-10-05',
        through_date: '2026-10-06',
      }),
    );

    expect((await snapshot()).days).toEqual(whole.days);
  });

  it('dois recálculos em paralelo na mesma carteira produzem o estado de um', async () => {
    await seedWithHistory();

    const order: string[] = [];

    /**
     * O atraso entra pelo `betweenLoadAndWrite` do próprio caso de uso, não por um
     * `setTimeout` no teste: o que precisa ser reproduzido é a janela entre a
     * leitura e a escrita, que é onde a corrida vive. Sem a trava, o segundo
     * recálculo leria o estado antigo e regravaria por cima do primeiro.
     */
    const run = (label: string, delayMs: number) =>
      recalculatePortfolio({
        unitOfWork,
        clock,
        betweenLoadAndWrite: async () => {
          order.push(`${label}:leu`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          order.push(`${label}:vai escrever`);
        },
      })({
        portfolio_id: PORTFOLIO,
        from_date: '2026-10-01',
        through_date: '2026-10-06',
      });

    const [a, b] = await Promise.all([run('a', 150), run('b', 0)]);

    expect(a.isSuccess()).toBe(true);
    expect(b.isSuccess()).toBe(true);

    // Serializados: quem leu primeiro escreveu antes de o outro ler.
    expect(order).toHaveLength(4);
    const primeiro = order[0]?.split(':')[0] ?? '';
    expect(order[1]).toBe(`${primeiro}:vai escrever`);
    expect(order[2]).not.toBe(`${primeiro}:leu`);

    // E o estado é o de uma execução só, não o de duas sobrepostas.
    const concorrente = await snapshot();

    await sql`DELETE FROM position_daily WHERE portfolio_id = ${PORTFOLIO}`;
    await sql`DELETE FROM portfolio_daily WHERE portfolio_id = ${PORTFOLIO}`;
    await sql`DELETE FROM realized_result WHERE portfolio_id = ${PORTFOLIO}`;

    unwrapSuccess(
      await recalculatePortfolio({ unitOfWork, clock })({
        portfolio_id: PORTFOLIO,
        from_date: '2026-10-01',
        through_date: '2026-10-06',
      }),
    );

    expect(concorrente.days).toEqual((await snapshot()).days);
  });
});
