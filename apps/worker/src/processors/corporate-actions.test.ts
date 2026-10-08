import {
  confirmPayout,
  corporateEventRunner,
  createPayout,
  ingestCorporateActions,
  materializeAnnouncedPayouts,
  reconcileAlerts,
} from '@patrimonio/application';
import type { Clock, CorporateActionProvider, UnitOfWork } from '@patrimonio/application';
import {
  closeDatabase,
  createConnection,
  createRepositories,
  createUnitOfWork,
  runMigrations,
} from '@patrimonio/db';
import type { Sql } from '@patrimonio/db';
import { environment } from '@patrimonio/env';
import { success } from '@patrimonio/shared';
import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Provento anunciado e evento corporativo, contra Postgres real. O provedor é
 * roteirizado porque nenhuma fonte gratuita confiável preenche isso hoje — o
 * lançamento segue manual, e o mecanismo existe pronto para o dia em que lançar
 * à mão virar incômodo.
 */
const PORTFOLIO = '0191e5a0-0000-7000-8000-00000000f001';
const OUTRA = '0191e5a0-0000-7000-8000-00000000f002';
const INSTITUTION = '0191e5a0-0000-7000-8000-00000000f003';
const ACAO = '0191e5a0-0000-7000-8000-00000000f004';

const DATE = '2026-10-06';

let sql: Sql;
let unitOfWork: UnitOfWork;

const clock: Clock = {
  now: () => new Date('2026-10-06T21:30:00.000Z'),
  today: () => DATE,
};

const payoutUseCase = () => createPayout({ unitOfWork, clock, jcpWithholdingPct: '15' });

const materialize = () =>
  materializeAnnouncedPayouts({
    unitOfWork,
    clock,
    createPayout: payoutUseCase(),
  });

const provider = (
  payouts: Parameters<CorporateActionProvider['fetchAnnouncements']> extends never
    ? never
    : readonly {
        readonly ticker: string;
        readonly payout_kind: 'dividend' | 'jcp';
        readonly record_date: string;
        readonly payment_date: string | null;
        readonly amount_per_share: string;
      }[],
  events: readonly {
    readonly ticker: string;
    readonly kind: 'split' | 'reverse_split' | 'bonus';
    readonly record_date: string;
    readonly ratio_from: string;
    readonly ratio_to: string;
  }[] = [],
): CorporateActionProvider => ({
  id: 'brapi-pro',
  fetchAnnouncements: async () => success({ payouts, events }),
});

const limpar = async (): Promise<void> => {
  await sql`delete from announced_payout`;
  await sql`delete from corporate_event`;
  await sql`delete from alert_instance`;
  await sql`delete from asset_price`;
  await sql`delete from market_source_run`;
  await sql`delete from position_daily`;
  await sql`delete from portfolio_daily`;
  await sql`delete from pipeline_outbox`;
  await sql`delete from transaction_undo`;
  await sql`delete from payout_dismissal`;
  await sql`delete from transaction`;
  await sql`delete from asset where id = ${ACAO}`;
  await sql`delete from portfolio where id in (${PORTFOLIO}, ${OUTRA})`;
  await sql`delete from institution where id = ${INSTITUTION}`;
};

beforeAll(async () => {
  await runMigrations(environment.database.connection);

  sql = createConnection({
    connection: environment.database.connection,
    poolSize: 4,
    applicationName: 'patrimonio-corporate-actions-test',
  });

  unitOfWork = createUnitOfWork(sql);
});

afterAll(async () => {
  await limpar();
  await closeDatabase(sql);
});

beforeEach(async () => {
  await limpar();

  await sql`
    insert into institution (id, name, role)
    values (${INSTITUTION}, 'Corretora Provento', 'custodian')
  `;
  await sql`
    insert into portfolio (id, name)
    values (${PORTFOLIO}, 'Carteira Provento'), (${OUTRA}, 'Carteira Sem Posição')
  `;
  await sql`
    insert into asset (id, ticker, name, origin, b3_type, price_source)
    values (${ACAO}, 'PRVA4', 'Ação do provento', 'market', 'stock', 'auto')
  `;
});

let sequencia = 0;

const comprar = async (date: string, quantity: number, portfolio = PORTFOLIO) => {
  sequencia += 1;

  await sql`
    insert into transaction (
      id, kind, trade_date, settlement_date, portfolio_id, asset_id, institution_id,
      quantity, unit_price, fees, gross_amount, net_amount
    )
    values (
      ${`0191e5a0-0000-7000-8000-${String(sequencia).padStart(12, '0')}`},
      'buy', ${date}, ${date}, ${portfolio}, ${ACAO}, ${INSTITUTION},
      ${quantity}, 30, 0, ${quantity * 30}, ${-quantity * 30}
    )
  `;
};

const anunciar = async (overrides: Record<string, unknown> = {}) =>
  unwrapSuccess(
    await createRepositories(sql).market.upsertAnnouncedPayouts([
      {
        asset_id: ACAO,
        payout_kind: 'dividend',
        record_date: '2026-09-30',
        payment_date: '2026-10-20',
        amount_per_share: '0.50000',
        source: 'brapi-pro',
        ...overrides,
      },
    ]),
  );

describe('provento anunciado vira lançamento a receber', () => {
  it('a quantidade é a da data-com, não a de hoje', async () => {
    await comprar('2026-09-01', 500);
    // Compra depois da data-com: não aumenta o provento.
    await comprar('2026-10-05', 500);
    await anunciar();

    const result = unwrapSuccess(await materialize()({}));

    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.quantity_at_record_date).toBe('500.00000000');
  });

  it('nasce a receber quando o pagamento é futuro', async () => {
    await comprar('2026-09-01', 100);
    await anunciar({ payment_date: '2026-10-20' });

    const result = unwrapSuccess(await materialize()({}));

    expect(result.created[0]?.confirmed).toBe(false);

    const [row] = await sql<{ confirmed_at: Date | null }[]>`
      select confirmed_at from transaction where kind = 'payout'
    `;
    expect(row?.confirmed_at).toBeNull();
  });

  it('entra confirmado quando o pagamento já passou', async () => {
    await comprar('2026-09-01', 100);
    await anunciar({ record_date: '2026-09-10', payment_date: '2026-09-25' });

    const result = unwrapSuccess(await materialize()({}));

    expect(result.created[0]?.confirmed).toBe(true);
  });

  it('ativo sem posição na data-com não gera lançamento nenhum', async () => {
    // A compra é posterior à data-com: a fonte anuncia o provento do papel, não
    // o seu.
    await comprar('2026-10-05', 100);
    await anunciar();

    const result = unwrapSuccess(await materialize()({}));

    expect(result.created).toEqual([]);
    expect(result.skipped).toHaveLength(1);

    const [total] = await sql<{ total: string }[]>`
      select count(*)::text as total from transaction where kind = 'payout'
    `;
    expect(Number(total?.total)).toBe(0);
  });

  it('só a carteira que tinha o papel recebe', async () => {
    await comprar('2026-09-01', 300, PORTFOLIO);
    await comprar('2026-10-05', 300, OUTRA);
    await anunciar();

    const result = unwrapSuccess(await materialize()({}));

    expect(result.created.map((payout) => payout.portfolio_id)).toEqual([PORTFOLIO]);
  });

  it('reprocessar a fila não cria o mesmo provento duas vezes', async () => {
    await comprar('2026-09-01', 100);
    await anunciar();

    unwrapSuccess(await materialize()({}));
    const segunda = unwrapSuccess(await materialize()({}));

    // O anúncio já materializado sai da fila de pendentes.
    expect(segunda.created).toEqual([]);

    const [total] = await sql<{ total: string }[]>`
      select count(*)::text as total from transaction where kind = 'payout'
    `;
    expect(Number(total?.total)).toBe(1);
  });

  it('o valor bruto é a quantidade da data-com vezes o valor por ação', async () => {
    await comprar('2026-09-01', 200);
    await anunciar({ amount_per_share: '0.50000' });

    unwrapSuccess(await materialize()({}));

    const [row] = await sql<{ gross_amount: string }[]>`
      select gross_amount from transaction where kind = 'payout'
    `;
    expect(row?.gross_amount).toBe('100.00');
  });

  it('o recebimento confirmado pelo usuário converte sem duplicar', async () => {
    await comprar('2026-09-01', 100);
    await anunciar({ payment_date: '2026-10-20' });

    const materialized = unwrapSuccess(await materialize()({}));
    const transactionId = materialized.created[0]?.transaction_id ?? '';

    const confirmada = unwrapSuccess(
      await confirmPayout({ unitOfWork, clock })(transactionId, {}),
    );

    expect(confirmada.transaction.confirmed_at).not.toBeNull();

    const [total] = await sql<{ total: string }[]>`
      select count(*)::text as total from transaction where kind = 'payout'
    `;
    expect(Number(total?.total)).toBe(1);
  });
});

describe('ingestão do que a fonte anuncia', () => {
  const ingest = (
    payouts: Parameters<typeof provider>[0],
    events: Parameters<typeof provider>[1] = [],
  ) =>
    ingestCorporateActions({
      unitOfWork,
      clock,
      provider: provider(payouts, events),
    });

  it('provento anunciado entra em announced_payout, não no livro', async () => {
    await comprar('2026-09-01', 100);

    const result = unwrapSuccess(
      await ingest([
        {
          ticker: 'PRVA4',
          payout_kind: 'dividend',
          record_date: '2026-09-30',
          payment_date: '2026-10-20',
          amount_per_share: '0.50000',
        },
      ])({ from: '2026-09-01' }),
    );

    expect(result.payouts_announced).toBe(1);

    const [lancamentos] = await sql<{ total: string }[]>`
      select count(*)::text as total from transaction where kind = 'payout'
    `;
    expect(Number(lancamentos?.total)).toBe(0);
  });

  it('anúncio de papel fora do cadastro é descartado', async () => {
    await comprar('2026-09-01', 100);

    const result = unwrapSuccess(
      await ingest([
        {
          ticker: 'XPTO3',
          payout_kind: 'dividend',
          record_date: '2026-09-30',
          payment_date: '2026-10-20',
          amount_per_share: '1.00',
        },
      ])({ from: '2026-09-01' }),
    );

    expect(result.payouts_announced).toBe(0);
    expect(result.unknown_tickers).toEqual(['XPTO3']);
  });

  it('evento detectado nasce não confirmado, e a quantidade não muda', async () => {
    await comprar('2026-09-01', 100);

    const result = unwrapSuccess(
      await ingest(
        [],
        [
          {
            ticker: 'PRVA4',
            kind: 'split',
            record_date: '2026-10-02',
            ratio_from: '1',
            ratio_to: '2',
          },
        ],
      )({ from: '2026-09-01' }),
    );

    expect(result.events_detected).toBe(1);

    const [evento] = await sql<{ confirmed_at: Date | null }[]>`
      select confirmed_at from corporate_event
    `;
    expect(evento?.confirmed_at).toBeNull();

    // Nenhum lançamento de evento corporativo foi criado: a quantidade em
    // carteira só muda depois da confirmação.
    const [total] = await sql<{ total: string }[]>`
      select count(*)::text as total
        from transaction where kind = 'corporate_event'
    `;
    expect(Number(total?.total)).toBe(0);
  });

  it('reanunciar o mesmo evento não cria linha nova', async () => {
    await comprar('2026-09-01', 100);

    const evento = {
      ticker: 'PRVA4',
      kind: 'split' as const,
      record_date: '2026-10-02',
      ratio_from: '1',
      ratio_to: '2',
    };

    unwrapSuccess(await ingest([], [evento])({ from: '2026-09-01' }));
    unwrapSuccess(await ingest([], [evento])({ from: '2026-09-01' }));

    const [total] = await sql<{ total: string }[]>`
      select count(*)::text as total from corporate_event
    `;
    expect(Number(total?.total)).toBe(1);
  });
});

describe('o alerta do evento corporativo', () => {
  const reconcile = () =>
    reconcileAlerts({
      unitOfWork,
      clock,
      runners: { corporate_event_pending: corporateEventRunner },
    });

  const registrarEvento = async (recordDate: string) =>
    unwrapSuccess(
      await createRepositories(sql).corporateEvents.upsert({
        asset_id: ACAO,
        kind: 'split',
        record_date: recordDate,
        ratio_from: '1',
        ratio_to: '2',
      }),
    );

  it('evento não confirmado abre alerta com os termos detectados', async () => {
    await comprar('2026-09-01', 100);
    await registrarEvento('2026-10-02');

    unwrapSuccess(await reconcile()({}));

    const [alerta] = await sql<
      { rule_kind: string; status: string; payload: Record<string, unknown> }[]
    >`select rule_kind, status, payload from alert_instance`;

    expect(alerta?.rule_kind).toBe('corporate_event_pending');
    expect(alerta?.status).toBe('open');
    expect(alerta?.payload).toMatchObject({
      ratio_from: '1.00000000',
      ratio_to: '2.00000000',
    });
  });

  it('evento com data-com futura ainda não é decisão de hoje', async () => {
    await comprar('2026-09-01', 100);
    await registrarEvento('2027-01-04');

    unwrapSuccess(await reconcile()({}));

    const [total] = await sql<{ total: string }[]>`
      select count(*)::text as total from alert_instance
    `;
    expect(Number(total?.total)).toBe(0);
  });

  it('confirmar o evento tira o alerta da fila', async () => {
    await comprar('2026-09-01', 100);
    const evento = await registrarEvento('2026-10-02');

    unwrapSuccess(await reconcile()({}));
    unwrapSuccess(
      await createRepositories(sql).corporateEvents.confirm(
        evento.id,
        '2026-10-06T21:30:00.000Z',
      ),
    );
    unwrapSuccess(await reconcile()({}));

    const [total] = await sql<{ total: string }[]>`
      select count(*)::text as total from alert_instance
    `;
    expect(Number(total?.total)).toBe(0);
  });

  it('ignorar o evento o remove da fila sem reaparecer no fechamento seguinte', async () => {
    await comprar('2026-09-01', 100);
    const evento = await registrarEvento('2026-10-02');

    unwrapSuccess(await reconcile()({}));

    const repositories = createRepositories(sql);
    unwrapSuccess(
      await repositories.alerts.setStatus(
        { rule_kind: 'corporate_event_pending', subject_id: evento.id },
        'ignored',
        null,
      ),
    );

    // O fechamento seguinte reconcilia de novo, e a decisão do usuário sobrevive.
    unwrapSuccess(await reconcile()({}));

    const visiveis = unwrapSuccess(
      await repositories.alerts.listActive({ on_date: DATE }),
    );

    expect(visiveis).toEqual([]);

    const [persistido] = await sql<{ status: string }[]>`
      select status from alert_instance
    `;
    expect(persistido?.status).toBe('ignored');
  });
});
