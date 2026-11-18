import { finance as fin } from '@patrimonio/calc';
import type { FinSnapshot } from '@patrimonio/domain';
import { UNDATED_DATE } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { runMutation, runRead, toFinanceError } from './runner.js';
import type { FinanceDeps, FinanceOutcome, MutationOptions, Op, OpOk } from './runner.js';
import type { AppError } from '../../errors/app-error.js';
import { NotFoundError } from '../../errors/app-error.js';

/** O limite do cartão visto pelo que se deve nele: faturas abertas e fechadas a pagar. */
const limitOf = (
  card: { readonly limit_amount: string },
  debt: { readonly abertas: string; readonly fechadas_a_pagar: string },
) => {
  const used = fin.dec(debt.abertas).plus(debt.fechadas_a_pagar);
  const limit = fin.dec(card.limit_amount);
  return {
    total: fin.money(limit),
    used: fin.money(used),
    available: fin.money(limit.minus(used)),
    percent: limit.gt(0)
      ? Number(used.times(100).div(limit).toDecimalPlaces(0).toString())
      : 0,
  };
};

const compareDatesText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

type RuleResult<T> = Either<readonly fin.FinRuleError[], T>;

/** Os aportes previstos de hoje até `target`, por mês, como a série e o saldo previsto os leem. */
const plannedAportesUntil = (
  data: FinSnapshot,
  today: string,
  target: string,
): fin.PlannedAporte[] => {
  const aportes: fin.PlannedAporte[] = [];
  for (
    let month = fin.monthKey(today);
    month <= fin.monthKey(target);
    month = fin.shiftMonthKey(month, 1)
  ) {
    for (const item of fin.plannedAportes(data, month)) {
      aportes.push({
        date: item.date,
        amount: item.amount,
        account_id: item.account_id,
        label: item.name,
        id: `previsto-aporte:${item.recurring_id}:${fin.monthKey(item.date)}`,
        portfolio_id: item.portfolio_id,
      });
    }
  }
  return aportes;
};

/** Opções comuns das escritas: preview, chave de idempotência e If-Match. */
export type WriteMeta = {
  readonly preview?: boolean | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly ifMatch?: number | undefined;
};

type VersionOf = (data: FinSnapshot) => number | undefined;

const run = (
  deps: FinanceDeps,
  name: string,
  input: unknown,
  meta: WriteMeta,
  op: Op,
  extra: {
    status?: number;
    version?: VersionOf;
    respond?: MutationOptions['respond'];
  } = {},
): Promise<Either<AppError, FinanceOutcome>> =>
  runMutation(deps, {
    name,
    input,
    op,
    preview: meta.preview,
    idempotencyKey: meta.idempotencyKey,
    status: extra.status,
    respond: extra.respond,
    ifMatch:
      meta.ifMatch !== undefined && extra.version !== undefined
        ? { get: extra.version, version: meta.ifMatch }
        : undefined,
  });

const ok = (
  data: FinSnapshot,
  result?: unknown,
  warnings?: readonly fin.Warning[],
): OpOk => ({
  data,
  result,
  warnings,
});

/** Converte o `Result` do motor num `OpOk`, aplicando `then` ao sucesso. */
const lift = <T>(result: RuleResult<T>, then: (value: T) => OpOk): ReturnType<Op> =>
  result.isFailure() ? failure(result.value) : success(then(result.value));

const notFound = (code: string, message: string): ReturnType<Op> =>
  failure([fin.rule(code, message, { status: 404 })]);

const pick = <T extends { id: string }>(rows: readonly T[], id: string): T | undefined =>
  rows.find((row) => row.id === id);

const byId =
  <K extends keyof FinSnapshot>(table: K) =>
  (id: string): VersionOf =>
  (data) =>
    (data[table] as readonly { id: string; version?: number }[]).find((r) => r.id === id)
      ?.version;

export type Period = {
  readonly month?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
};

/** `from`/`to` valem; senão o mês pedido; senão o mês de hoje. */
const resolveRange = (period: Period, today: string): fin.DateRange =>
  period.from !== undefined && period.to !== undefined
    ? { from: period.from, to: period.to }
    : fin.monthRange(period.month ?? fin.monthKey(today));

export type EntryInput = fin.EntryDraft;
export type Scope = fin.InstallmentScope;

/**
 * Casos de uso de Finanças. Cada escrita é uma função pura do motor passada ao
 * executor: o preview e a gravação percorrem o mesmo caminho.
 */
export const financeUseCases = (deps: FinanceDeps) => ({
  // ─── Leituras ───────────────────────────────────────────────────────────────
  /** Tudo que Finanças guarda, mais o "hoje" do servidor (fuso de São Paulo). */
  getSnapshot: () => runRead(deps, (data, today) => ({ today, ...data })),

  /**
   * LIV-02 · O livro unificado: Finanças e carteiras numa leitura de duas consultas
   * (a foto de Finanças e as movimentações de carteira do período). Os totais saem
   * das linhas já filtradas, então respeitam os filtros e não dependem da página.
   */
  getBook: (
    period: Period,
    filters: Omit<fin.BookFilters, 'range'>,
    cursor: string | undefined,
    limit: number,
    group: fin.BookGroupBy | undefined,
  ) =>
    deps.unitOfWork.run<AppError, unknown>(async ({ finance, ledger }) => {
      const loaded = await finance.load();
      if (loaded.isFailure()) return loaded;
      const range = resolveRange(period, deps.clock.today());
      const investments = await ledger.bookRows(range);
      if (investments.isFailure()) return investments;

      const data = loaded.value;
      const all = fin.bookRows(data, investments.value, range);
      const rows = fin.filterBook(data, all, { ...filters, range });
      const page = fin.paginateBook(rows, cursor, limit);
      const names = new Map(
        investments.value.map((row) => [row.portfolio_id, row.portfolio_name] as const),
      );
      return success({
        range,
        rows: page.rows,
        next_cursor: page.next_cursor,
        totals: fin.bookTotals(rows, fin.rowNatureOf(data)),
        count: rows.length,
        groups: group === undefined ? null : fin.groupBook(data, rows, group, names),
        // Os previstos sem data: fora de qualquer período e de todo total, mas
        // com os mesmos filtros (tipo, conta, categoria, busca) da lista.
        undated: fin.filterBook(
          data,
          fin.bookRows(data, []).filter((row) => row.date === UNDATED_DATE),
          { ...filters, range: { from: UNDATED_DATE, to: UNDATED_DATE } },
        ),
      });
    }),

  /** Os `count` meses que terminam em `month`, para Receitas × despesas. */
  getFlowSeries: (month: string, count: number) =>
    deps.unitOfWork.run<AppError, unknown>(async ({ finance, ledger }) => {
      const loaded = await finance.load();
      if (loaded.isFailure()) return loaded;
      const months = Array.from({ length: count }, (_, index) =>
        fin.shiftMonthKey(month, index - (count - 1)),
      );
      const first = months[0] ?? month;
      const range = { from: fin.monthStart(first), to: fin.monthRange(month).to };
      const investments = await ledger.bookRows(range);
      if (investments.isFailure()) return investments;
      const data = loaded.value;
      const rows = fin.bookRows(data, investments.value, range);
      return success({ months: fin.flowSeries(rows, months, fin.rowNatureOf(data)) });
    }),

  getOverview: (month?: string) =>
    runRead(deps, (data, today) =>
      fin.overview(data, month ?? fin.monthKey(today), today),
    ),

  /**
   * LIV-09 · Patrimônio e Livre após faturas. `emCarteiras` é a soma das carteiras
   * na última consolidação (`null` quando nenhuma foi consolidada).
   */
  /**
   * LIV-10 · Saldo previsto em `date` e, com `from`/`to`, a série diária com o
   * menor saldo. Uma função serve Visão geral, Contas e qualquer outra leitura.
   */
  getForecast: (query: {
    date?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  }) =>
    runRead(deps, (data, today) => {
      const target = query.date ?? query.to ?? fin.endOfMonth(today);
      const aportes = plannedAportesUntil(data, today, target);
      return {
        date: target,
        balance: fin.projectedBalance(data, target, today, aportes),
        parts: fin.projectedParts(data, target, today, aportes),
        planned_aportes: aportes.filter((a) => a.date <= target),
        series: fin.forecastSeries(
          data,
          { from: query.from ?? fin.startOfMonth(today), to: target },
          today,
          aportes,
        ),
      };
    }),

  getWealth: (emCarteiras: string | null) =>
    runRead(deps, (data, today) => fin.wealthSummary(data, today, emCarteiras)),

  listEntries: (
    filters: Omit<fin.EntryFilters, 'range'> & Period,
    cursor: string | undefined,
    limit: number,
    group?: fin.GroupBy,
  ) =>
    runRead(deps, (data, today) => {
      const range = resolveRange(filters, today);
      const rows = fin.filterEntries(data, { ...filters, range });
      const page = fin.paginate(rows, cursor, limit);
      const enrich = (entry: FinSnapshot['entries'][number]) => ({
        ...entry,
        category_name: pick(data.categories, entry.category_id)?.name ?? null,
        sources: entry.payments.map((p) => ({
          ...p,
          name: fin.sourceName(data, { type: p.source_type, id: p.source_id }),
        })),
        overdue: fin.isOverdue(data, entry, today),
        charge: fin.isCharge(data, entry),
      });
      return {
        range,
        indicators: fin.indicators(rows, range),
        entries: page.entries.map(enrich),
        next_cursor: page.next_cursor,
        total: rows.length,
        groups: group === undefined ? null : fin.groupEntries(data, page.entries, group),
      };
    }),

  getEntry: (id: string) => runRead(deps, (data) => pick(data.entries, id) ?? null),

  getAccounts: (period: Period, showArchived: boolean) =>
    runRead(deps, (data, today) => {
      const range = resolveRange(period, today);
      const overview = fin.accountsOverview(data, range, today, showArchived);
      // CTA-01 · o previsto de fim de mês, por conta, pela mesma função do total (RN-U16).
      const target = fin.endOfMonth(today);
      const aportes = plannedAportesUntil(data, today, target);
      const accounts = overview.accounts.map((row) => ({
        ...row,
        projected_month_end: fin.projectedBalance(
          data,
          target,
          today,
          aportes,
          row.account.id,
        ),
        next_planned: fin.nextPlanned(data, row.account.id, today, aportes),
      }));
      const counted = accounts.filter((r) => !r.account.archived && r.account.in_wealth);
      return {
        range,
        ...overview,
        accounts,
        projected_total: fin.money(
          fin.total(counted.map((r) => fin.dec(r.projected_month_end))),
        ),
        projected_on: target,
        /** CTA-01 · Faturas a pagar e livre após faturas, as mesmas contas da Visão geral. */
        debt: fin.wealthSummary(data, today, null),
        as_of: today,
      };
    }),

  getStatement: (accountId: string, period: Period) =>
    deps.unitOfWork.run<AppError, unknown>(async ({ finance, ledger }) => {
      const loaded = await finance.load();
      if (loaded.isFailure()) return loaded;
      const data = loaded.value;
      const account = pick(data.accounts, accountId);
      if (account === undefined) return success(null);
      const today = deps.clock.today();
      const range = resolveRange(period, today);
      const stmt = fin.statement(data, accountId, range, today);

      // O portfolio de cada perna de carteira, pela ligação do evento.
      const rows = await ledger.bookRows({ from: account.opening_date, to: range.to });
      if (rows.isFailure()) return rows;
      const portfolioByEvent = new Map<string, string>();
      for (const row of rows.value) {
        if (row.event_id !== null) portfolioByEvent.set(row.event_id, row.portfolio_id);
      }
      const portfolioNames = new Map(
        rows.value.map((row) => [row.portfolio_id, row.portfolio_name] as const),
      );
      const accountName = (id: string | undefined): string | null =>
        id === undefined ? null : (pick(data.accounts, id)?.name ?? null);
      const categoryName = (id: string | null): string | null =>
        id === null ? null : (pick(data.categories, id)?.name ?? null);
      const portfolioName = (id: string | null | undefined): string =>
        (id === null || id === undefined ? undefined : portfolioNames.get(id)) ??
        'carteira';

      const lines = stmt.lines.map((line) => {
        const movement =
          line.entry_id === null ? pick(data.movements, line.id) : undefined;
        const base = { ...line, portfolio_id: null as string | null };
        if (line.origin === 'lancamento') {
          const income = Number(line.amount) > 0;
          return {
            ...base,
            kind: income ? 'receita' : 'despesa',
            from: income ? categoryName(line.category_id) : null,
            to: income ? account.name : categoryName(line.category_id),
          };
        }
        if (line.origin === 'fatura') {
          const payment = pick(data.invoice_payments, line.id);
          const card =
            payment === undefined ? undefined : pick(data.cards, payment.card_id);
          return {
            ...base,
            kind: 'fatura',
            from: account.name,
            to: card?.name ?? null,
          };
        }
        if (
          line.origin === 'transferencia_entrada' ||
          line.origin === 'transferencia_saida'
        ) {
          const other = data.movements.find(
            (m) =>
              m.transfer_id !== null &&
              m.transfer_id === movement?.transfer_id &&
              m.id !== movement.id,
          );
          const entering = line.origin === 'transferencia_entrada';
          const counterpart = accountName(other?.account_id);
          return {
            ...base,
            kind: 'transferencia',
            from: entering ? counterpart : account.name,
            to: entering ? account.name : counterpart,
          };
        }
        const portfolioId =
          movement?.event_id == null
            ? null
            : (portfolioByEvent.get(movement.event_id) ?? null);
        if (line.origin === 'aporte') {
          return {
            ...base,
            kind: 'aporte',
            portfolio_id: portfolioId,
            from: account.name,
            to: portfolioName(portfolioId),
          };
        }
        if (line.origin === 'resgate' || line.origin === 'provento') {
          return {
            ...base,
            kind: line.origin,
            portfolio_id: portfolioId,
            from: portfolioName(portfolioId),
            to: account.name,
          };
        }
        return { ...base, kind: 'ajuste', from: null, to: null };
      });

      const target = range.to;
      const aportes = plannedAportesUntil(data, today, target);
      const planned = fin
        .plannedStatement(data, accountId, today, range, aportes)
        .map((line) => {
          const card = line.card_id === null ? undefined : pick(data.cards, line.card_id);
          if (line.origin === 'receita') {
            return { ...line, from: categoryName(line.category_id), to: account.name };
          }
          if (line.origin === 'despesa') {
            return { ...line, from: null, to: categoryName(line.category_id) };
          }
          if (line.origin === 'aporte') {
            return { ...line, from: account.name, to: portfolioName(line.portfolio_id) };
          }
          return { ...line, from: account.name, to: card?.name ?? null };
        });
      const future = compareDatesText(range.to, today) > 0;
      const last = planned.at(-1);
      const article =
        last === undefined
          ? ''
          : last.origin === 'aporte'
            ? 'o aporte previsto'
            : last.origin === 'fatura'
              ? 'a fatura prevista'
              : 'o lançamento previsto';

      return success({
        account,
        range,
        opening: stmt.opening,
        entered: stmt.entered,
        left: stmt.left,
        closing: stmt.closing,
        through: stmt.through,
        entered_count: lines.filter((l) => Number(l.amount) > 0).length,
        left_count: lines.filter((l) => Number(l.amount) < 0).length,
        lines,
        planned,
        /** O saldo previsto ao fim do período; nulo quando o período já acabou. */
        projected: future
          ? (last?.balance_after ?? fin.money(fin.accountBalance(data, accountId, today)))
          : null,
        projected_note:
          last === undefined
            ? `sem previstos até ${range.to.slice(8)}/${range.to.slice(5, 7)}`
            : `após ${article} de ${last.date.slice(8)}/${last.date.slice(5, 7)}`,
      });
    }),

  getCards: () =>
    runRead(deps, (data, today) => {
      const cards = fin.activeCards(data).map((card) => ({
        ...fin.cardSummary(data, card, today),
        limit: limitOf(card, fin.cardDebt(data, card, today)),
        debt: (() => {
          const debt = fin.cardDebt(data, card, today);
          return {
            ...debt,
            /** Aberta + fechada a pagar, para a lista de cartões do cabeçalho. */
            total: fin.money(fin.dec(debt.abertas).plus(debt.fechadas_a_pagar)),
          };
        })(),
        ...fin.cardDetail(data, card, today),
      }));
      // CRT-01 · Os totais da faixa e dos painéis, somados aqui para a tela só mostrar.
      const owed = cards.flatMap((c) =>
        c.invoices.filter((i) => fin.dec(i.remaining).gt(0)),
      );
      const closed = owed.filter((i) => i.status === 'fechada' || i.status === 'parcial');
      const open = owed.filter((i) => i.status === 'aberta');
      const limit = fin.total(cards.map((c) => fin.dec(c.card.limit_amount)));
      const used = fin.total(cards.map((c) => fin.dec(c.limit.used)));
      const planned = cards
        .flatMap((c) =>
          c.planned_payments
            .filter((p) => p.status === 'fechada' || p.status === 'parcial')
            .map((p) => ({ ...p, card_id: c.card.id })),
        )
        .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
      const installments = cards.flatMap((c) =>
        c.installments.map((plan) => ({ ...plan, card_id: c.card.id })),
      );
      return {
        cards,
        /** CRT-01/02 · Os mesmos números de Livre após faturas que Visão geral e Contas leem. */
        wealth: fin.wealthSummary(data, today, null),
        as_of: today,
        upcoming: fin.upcomingInvoices(data, today),
        open_total: fin.money(fin.openInvoicesTotal(data, today)),
        archived: data.cards.filter((card) => card.archived),
        summary: {
          closed_count: closed.length,
          closed_first_due: closed.map((i) => i.due).sort()[0] ?? null,
          open_count: open.length,
          open_dues: [...new Set(open.map((i) => i.due))].sort(),
          limit_total: fin.money(limit),
          limit_available: fin.money(limit.minus(used)),
          limit_used_percent: limit.gt(0)
            ? Number(used.div(limit).times(100).toDecimalPlaces(0).toString())
            : 0,
        },
        planned_payments: planned,
        planned_total: fin.money(fin.total(planned.map((p) => fin.dec(p.amount)))),
        installments,
        installments_total: fin.money(
          fin.total(installments.map((p) => fin.dec(p.remaining))),
        ),
      };
    }),

  /** CRT-03 · O cartão: dívida, faturas por mês, parcelamentos e pagamentos previstos. */
  getCard: (cardId: string) =>
    runRead(deps, (data, today) => {
      const card = pick(data.cards, cardId);
      if (card === undefined) return null;
      const detail = fin.cardDetail(data, card, today);
      const openKey = fin.invoiceKeyOf(card, today);
      const keys = fin.cardInvoiceKeys(data, card, today);

      // CRT-03 · A fatura aberta por categoria, com o peso de cada uma, somado aqui.
      const byCategory = new Map<string, ReturnType<typeof fin.dec>>();
      for (const line of fin.invoiceLines(data, card, openKey)) {
        if (line.block === 'creditos') continue;
        const key = line.category_id ?? '';
        byCategory.set(key, (byCategory.get(key) ?? fin.dec('0')).plus(line.amount));
      }
      const openTotal = fin.total([...byCategory.values()]);
      const open_invoice_categories = [...byCategory]
        .map(([category_id, amount]) => ({
          category_id: category_id === '' ? null : category_id,
          name: pick(data.categories, category_id)?.name ?? 'Sem categoria',
          amount: fin.money(amount),
          percent: openTotal.gt(0)
            ? Number(amount.div(openTotal).times(100).toDecimalPlaces(0).toString())
            : 0,
        }))
        .sort((a, b) => Number(b.amount) - Number(a.amount));

      // A média das cinco últimas faturas já fechadas (a aberta e as previstas ficam de fora).
      const closed = detail.invoices
        .filter((i) => i.status !== 'aberta' && i.status !== 'prevista')
        .slice(0, 5);
      const average_closed =
        closed.length === 0
          ? null
          : fin.money(
              fin.total(closed.map((i) => fin.dec(i.total))).div(String(closed.length)),
            );

      // As parcelas que ainda vão cair em faturas futuras, uma linha por parcela.
      const future_parts: {
        month: string;
        description: string;
        no: number;
        total: number;
        amount: string;
      }[] = [];
      for (const key of keys) {
        if (key <= openKey) continue;
        for (const line of fin.invoiceLines(data, card, key)) {
          if (line.installment === null || line.block === 'creditos') continue;
          future_parts.push({
            month: key,
            description: line.description,
            no: line.installment.no,
            total: line.installment.total,
            amount: line.amount,
          });
        }
      }
      future_parts.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

      return {
        summary: fin.cardSummary(data, card, today),
        debt: fin.cardDebt(data, card, today),
        limit: limitOf(card, fin.cardDebt(data, card, today)),
        as_of: today,
        ...detail,
        open_month: openKey,
        open_invoice_categories,
        average_closed,
        future_parts,
        future_total: fin.money(fin.total(future_parts.map((p) => fin.dec(p.amount)))),
      };
    }),

  getInvoice: (cardId: string, month: string) =>
    runRead(deps, (data, today) => {
      const card = pick(data.cards, cardId);
      if (card === undefined) return null;
      const lines = fin.invoiceLines(data, card, month);
      const detail = fin.cardDetail(data, card, today);
      const debt = fin.cardDebt(data, card, today);
      const signed = (line: {
        block: string;
        amount: string;
      }): ReturnType<typeof fin.dec> =>
        line.block === 'creditos' ? fin.dec(line.amount).neg() : fin.dec(line.amount);

      // CRT-04 · A fatura acumulada: o total até cada linha, em ordem de data.
      let running = fin.dec('0');
      const chronological = [...lines]
        .sort((a, b) =>
          a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
        )
        .map((line) => {
          running = running.plus(signed(line));
          return { ...line, accumulated: fin.money(running) };
        });

      const bought = lines.filter((l) => l.block === 'compras' || l.block === 'parcelas');
      const dates = bought.map((l) => l.date).sort();
      const byCategory = new Map<string, ReturnType<typeof fin.dec>>();
      for (const line of bought) {
        const key = line.category_id ?? '';
        byCategory.set(key, (byCategory.get(key) ?? fin.dec('0')).plus(line.amount));
      }
      const boughtTotal = fin.total([...byCategory.values()]);
      const top = [...byCategory].sort((a, b) => (a[1].gt(b[1]) ? -1 : 1))[0];
      const largest_category =
        top === undefined
          ? null
          : {
              name: pick(data.categories, top[0])?.name ?? 'Sem categoria',
              amount: fin.money(top[1]),
              percent: boughtTotal.gt(0)
                ? Number(top[1].div(boughtTotal).times(100).toDecimalPlaces(0).toString())
                : 0,
            };

      // CRT-05 · O pagamento previsto: a própria fatura, se está fechada a pagar; senão a
      // fechada mais antiga do cartão. Antes e depois mostram o efeito de pagá-la.
      const own = detail.invoices.find((i) => i.month === month);
      const ownClosed =
        own !== undefined &&
        (own.status === 'fechada' || own.status === 'parcial') &&
        fin.dec(own.remaining).gt(0);
      const payKey = ownClosed
        ? month
        : detail.invoices
            .filter(
              (i) =>
                (i.status === 'fechada' || i.status === 'parcial') &&
                fin.dec(i.remaining).gt(0),
            )
            .at(-1)?.month;
      let payable: unknown = null;
      if (payKey !== undefined) {
        const summary = fin.invoiceSummary(data, card, payKey, today);
        const payLines = fin.invoiceLines(data, card, payKey);
        const totals = fin.invoiceTotals(payLines);
        const after = fin.projectedBalance(
          data,
          summary.due,
          today,
          plannedAportesUntil(data, today, summary.due),
        );
        const before = fin.dec(after).plus(summary.remaining);
        const owedBefore = fin.wealthSummary(data, today, null).total_devido;
        const spent = fin.categoryBreakdown(
          data,
          'despesa',
          fin.monthRange(fin.monthKey(today)),
        );
        payable = {
          summary,
          period: fin.invoicePeriod(card, payKey),
          preview: {
            due: summary.due,
            em_contas: { before: fin.money(before), after },
            fatura: { before: summary.remaining, after: '0.00' },
            total_devido: {
              before: owedBefore,
              after: fin.money(fin.dec(owedBefore).minus(summary.remaining)),
            },
            despesas_do_mes: { before: spent.total, after: spent.total },
          },
          breakdown: {
            compras: {
              count: payLines.filter((l) => l.block === 'compras').length,
              amount: totals.compras,
            },
            parcelas: payLines
              .filter((l) => l.block === 'parcelas' && l.installment !== null)
              .map((l) => ({
                description: l.description,
                no: l.installment?.no ?? 0,
                total: l.installment?.total ?? 0,
                amount: l.amount,
              })),
            creditos: totals.creditos,
            encargos: totals.encargos,
            total: totals.total,
          },
        };
      }

      return {
        card,
        summary: fin.invoiceSummary(data, card, month, today),
        period: fin.invoicePeriod(card, month),
        lines: chronological,
        totals: fin.invoiceTotals(lines),
        payments: data.invoice_payments.filter(
          (p) => p.card_id === cardId && p.invoice_month === month,
        ),
        months: fin.cardInvoiceKeys(data, card, today),
        /** Faturas sem nenhum pagamento: as que aceitam estorno, mover, crédito e encargo. */
        unpaid_months: fin
          .cardInvoiceKeys(data, card, today)
          .filter((key) => fin.invoicePaid(data, cardId, key).lte(0)),
        /** As faturas do seletor do cabeçalho, da mais recente à mais antiga. */
        invoices: detail.invoices
          .filter((i) => i.status !== 'prevista')
          .map((i) => ({ month: i.month, status: i.status, total: i.total })),
        limit: limitOf(card, debt),
        purchases: {
          count: bought.length,
          from: dates[0] ?? null,
          to: dates.at(-1) ?? null,
        },
        largest_category,
        payable,
        as_of: today,
      };
    }),

  getCategoryBreakdown: (kind: 'receita' | 'despesa', range: fin.DateRange) =>
    runRead(deps, (data) => fin.categoryBreakdown(data, kind, range)),

  getCategoryUsage: (range: fin.DateRange) =>
    runRead(deps, (data) => fin.categoryPeriodUsage(data, range)),

  listFinanceCategories: (includeArchived: boolean) =>
    runRead(deps, (data) =>
      data.categories.filter((category) => includeArchived || !category.archived),
    ),

  search: (query: string, limit?: number) =>
    runRead(deps, (data, today) => fin.searchFinance(data, query, today, limit)),

  exportEntries: (filters: Omit<fin.EntryFilters, 'range'> & Period) =>
    runRead(deps, (data, today) => {
      const rows = fin.filterEntries(data, {
        ...filters,
        range: resolveRange(filters, today),
      });
      return rows.map((entry) => ({
        entry,
        category: pick(data.categories, entry.category_id)?.name ?? '',
        sources: entry.payments.map((p) =>
          fin.sourceName(data, { type: p.source_type, id: p.source_id }),
        ),
      }));
    }),

  // ─── Categorias ─────────────────────────────────────────────────────────────
  createCategory: (input: fin.CategoryInput, meta: WriteMeta = {}) =>
    run(
      deps,
      'category.create',
      input,
      meta,
      (data, ctx) =>
        lift(fin.createCategory(data, input, ctx.newId), (v) => ok(v.data, v.category)),
      { status: 201 },
    ),

  updateCategory: (id: string, input: fin.CategoryInput, meta: WriteMeta = {}) =>
    run(
      deps,
      'category.update',
      { id, input },
      meta,
      (data) =>
        lift(fin.updateCategory(data, id, input), (next) =>
          ok(next, pick(next.categories, id)),
        ),
      { version: byId('categories')(id) },
    ),

  archiveCategory: (id: string, archived: boolean, meta: WriteMeta = {}) =>
    run(
      deps,
      'category.archive',
      { id, archived },
      meta,
      (data) =>
        lift(fin.setCategoryArchived(data, id, archived), (next) =>
          ok(next, pick(next.categories, id)),
        ),
      { version: byId('categories')(id) },
    ),

  deleteCategory: (id: string, meta: WriteMeta = {}) =>
    run(
      deps,
      'category.delete',
      { id },
      meta,
      (data) => lift(fin.removeCategory(data, id), (next) => ok(next, { id })),
      { version: byId('categories')(id) },
    ),

  /** CAT-04 · Excluir com destino, numa transação só. */
  deleteCategoryMoving: (id: string, moveTo: string, meta: WriteMeta = {}) =>
    run(
      deps,
      'category.delete_moving',
      { id, move_to: moveTo },
      meta,
      (data) =>
        lift(fin.removeCategoryMoving(data, id, moveTo), (next) =>
          ok(next, { id, move_to: moveTo }),
        ),
      { version: byId('categories')(id) },
    ),

  // ─── Contas ─────────────────────────────────────────────────────────────────
  createAccount: (input: fin.AccountInput, meta: WriteMeta = {}) =>
    run(
      deps,
      'account.create',
      input,
      meta,
      (data, ctx) =>
        lift(fin.createAccount(data, input, ctx.newId), (v) => ok(v.data, v.account)),
      { status: 201 },
    ),

  updateAccount: (id: string, input: fin.AccountInput, meta: WriteMeta = {}) =>
    run(
      deps,
      'account.update',
      { id, input },
      meta,
      (data) =>
        lift(fin.updateAccount(data, id, input), (next) =>
          ok(next, pick(next.accounts, id)),
        ),
      { version: byId('accounts')(id) },
    ),

  archiveAccount: (id: string, archived: boolean, meta: WriteMeta = {}) =>
    run(
      deps,
      'account.archive',
      { id, archived },
      meta,
      (data) =>
        lift(fin.setAccountArchived(data, id, archived), (next) =>
          ok(next, pick(next.accounts, id)),
        ),
      { version: byId('accounts')(id) },
    ),

  deleteAccount: (id: string, meta: WriteMeta = {}) =>
    run(
      deps,
      'account.delete',
      { id },
      meta,
      (data) => lift(fin.removeAccount(data, id), (next) => ok(next, { id })),
      { version: byId('accounts')(id) },
    ),

  // ─── Cartões ────────────────────────────────────────────────────────────────
  createCard: (input: fin.CardInput, meta: WriteMeta = {}) =>
    run(
      deps,
      'card.create',
      input,
      meta,
      (data, ctx) =>
        lift(fin.createCard(data, input, ctx.newId), (v) => ok(v.data, v.card)),
      { status: 201 },
    ),

  updateCard: (id: string, input: fin.CardInput, meta: WriteMeta = {}) =>
    run(
      deps,
      'card.update',
      { id, input },
      meta,
      (data) =>
        lift(fin.updateCard(data, id, input), (next) => ok(next, pick(next.cards, id))),
      { version: byId('cards')(id) },
    ),

  archiveCard: (id: string, archived: boolean, meta: WriteMeta = {}) =>
    run(
      deps,
      'card.archive',
      { id, archived },
      meta,
      (data) =>
        lift(fin.setCardArchived(data, id, archived), (next) =>
          ok(next, pick(next.cards, id)),
        ),
      { version: byId('cards')(id) },
    ),

  deleteCard: (id: string, meta: WriteMeta = {}) =>
    run(
      deps,
      'card.delete',
      { id },
      meta,
      (data) => lift(fin.removeCard(data, id), (next) => ok(next, { id })),
      { version: byId('cards')(id) },
    ),

  // ─── Recorrentes ────────────────────────────────────────────────────────────
  listRecurrings: () =>
    runRead(deps, (data, today) => ({
      recurrings: data.recurrings.map((recurring) => ({
        ...recurring,
        next_planned: fin.nextOccurrence(data, recurring, today),
      })),
      summary: fin.recurringsSummary(data, today),
    })),

  createRecurring: (input: fin.RecurringInput, meta: WriteMeta = {}) =>
    run(
      deps,
      'recurring.create',
      input,
      meta,
      (data, ctx) =>
        lift(fin.createRecurring(data, input, ctx.newId), (v) => {
          const synced = fin.syncRecurring(v.data, ctx.today, ctx.newId);
          return ok(synced, v.recurring);
        }),
      { status: 201 },
    ),

  updateRecurring: (id: string, input: fin.RecurringInput, meta: WriteMeta = {}) =>
    run(
      deps,
      'recurring.update',
      { id, input },
      meta,
      (data) =>
        lift(fin.updateRecurringFields(data, id, input), (v) => {
          const refreshed = fin.refreshPending(v.data, v.recurring);
          return ok(refreshed, {
            recurring: v.recurring,
            pending_changes: fin.pendingChanges(data, refreshed, id),
          });
        }),
      { version: byId('recurrings')(id) },
    ),

  setRecurringActive: (id: string, active: boolean, meta: WriteMeta = {}) =>
    run(
      deps,
      'recurring.active',
      { id, active },
      meta,
      (data, ctx) =>
        lift(fin.setRecurringActive(data, id, active), (v) =>
          ok(
            fin.applyActiveEffects(v.data, v.recurring, ctx.today, ctx.newId),
            v.recurring,
          ),
        ),
      { version: byId('recurrings')(id) },
    ),

  skipRecurringMonth: (id: string, month: string, meta: WriteMeta = {}) =>
    run(deps, 'recurring.skip', { id, month }, meta, (data) =>
      pick(data.recurrings, id) === undefined
        ? notFound('RECURRING_NOT_FOUND', 'Recorrente não encontrado.')
        : success(ok(fin.skipMonth(data, id, month), { id, month })),
    ),

  deleteRecurring: (id: string, meta: WriteMeta = {}) =>
    run(
      deps,
      'recurring.delete',
      { id },
      meta,
      (data) =>
        pick(data.recurrings, id) === undefined
          ? notFound('RECURRING_NOT_FOUND', 'Recorrente não encontrado.')
          : success(ok(fin.removeRecurring(data, id), { id })),
      { version: byId('recurrings')(id) },
    ),

  // ─── Lançamentos ────────────────────────────────────────────────────────────
  createEntry: (draft: fin.EntryDraft, meta: WriteMeta = {}) =>
    run(
      deps,
      'entry.create',
      draft,
      meta,
      (data, ctx) =>
        lift(fin.createEntries(data, draft, ctx.today, ctx.newId), (v) =>
          ok(
            v.data,
            v.created.map((e) => e.id),
          ),
        ),
      {
        status: 201,
        respond: (okResult, after) => ({
          entries: (okResult.result as string[]).map((id) => pick(after.entries, id)),
        }),
      },
    ),

  updateEntry: (
    id: string,
    draft: fin.EntryDraft,
    scope: Scope | undefined,
    meta: WriteMeta = {},
  ) =>
    run(
      deps,
      'entry.update',
      { id, draft, scope },
      meta,
      (data, ctx) => {
        const current = pick(data.entries, id);
        if (current === undefined)
          return notFound('ENTRY_NOT_FOUND', 'Lançamento não encontrado.');
        const installment = current.installment !== null;
        if (installment && scope === undefined) return failure([fin.scopeRequired()]);
        if (!installment && scope !== undefined) return failure([fin.scopeInvalid()]);
        const next = installment
          ? fin.updateInstallments(data, id, draft, scope as Scope)
          : fin.updateEntry(data, id, draft, ctx.today);
        return lift(next, (value) => ok(value, id));
      },
      {
        version: byId('entries')(id),
        respond: (okResult, after) => ({
          entry: pick(after.entries, okResult.result as string),
        }),
      },
    ),

  confirmEntry: (id: string, input: fin.ConfirmInput, meta: WriteMeta = {}) =>
    run(
      deps,
      'entry.confirm',
      { id, input },
      meta,
      (data, ctx) =>
        lift(fin.confirmEntry(data, id, input, ctx.today), (value) => ok(value, id)),
      {
        version: byId('entries')(id),
        respond: (okResult, after) => ({
          entry: pick(after.entries, okResult.result as string),
        }),
      },
    ),

  deleteEntry: (id: string, scope: Scope | undefined, meta: WriteMeta = {}) =>
    run(
      deps,
      'entry.delete',
      { id, scope },
      meta,
      (data) => {
        const current = pick(data.entries, id);
        if (current === undefined)
          return notFound('ENTRY_NOT_FOUND', 'Lançamento não encontrado.');
        const installment = current.installment !== null;
        if (installment && scope === undefined) return failure([fin.scopeRequired()]);
        if (!installment && scope !== undefined) return failure([fin.scopeInvalid()]);
        const next = installment
          ? fin.deleteInstallments(data, id, scope as Scope)
          : fin.deleteEntries(data, [id]);
        return success(ok(next, { id }));
      },
      { version: byId('entries')(id) },
    ),

  // ─── Transferências ─────────────────────────────────────────────────────────
  createTransfer: (input: fin.TransferInput, meta: WriteMeta = {}) =>
    run(
      deps,
      'transfer.create',
      input,
      meta,
      (data, ctx) =>
        lift(fin.createTransfer(data, input, ctx.today, ctx.newId), (v) =>
          ok(v.data, { transfer_id: v.transfer_id }),
        ),
      { status: 201 },
    ),

  updateTransfer: (id: string, input: fin.TransferInput, meta: WriteMeta = {}) =>
    run(deps, 'transfer.update', { id, input }, meta, (data, ctx) =>
      lift(fin.updateTransfer(data, id, input, ctx.today), (next) =>
        ok(next, { transfer_id: id }),
      ),
    ),

  deleteTransfer: (id: string, meta: WriteMeta = {}) =>
    run(deps, 'transfer.delete', { id }, meta, (data) =>
      data.movements.some((m) => m.transfer_id === id)
        ? success(ok(fin.deleteTransfer(data, id), { transfer_id: id }))
        : notFound('TRANSFER_NOT_FOUND', 'Transferência não encontrada.'),
    ),

  // ─── Faturas ────────────────────────────────────────────────────────────────
  payInvoice: (
    cardId: string,
    month: string,
    input: fin.PayInvoiceInput,
    meta: WriteMeta = {},
  ) =>
    run(
      deps,
      'invoice.pay',
      { cardId, month, input },
      meta,
      (data, ctx) =>
        lift(fin.payInvoice(data, cardId, month, input, ctx.today, ctx.newId), (v) =>
          ok(v.data, { card_id: cardId, month, payment_id: v.payment_id }),
        ),
      { status: 201 },
    ),

  deleteInvoicePayment: (paymentId: string, meta: WriteMeta = {}) =>
    run(deps, 'invoice.payment.delete', { paymentId }, meta, (data) =>
      lift(fin.deleteInvoicePayment(data, paymentId), (next) =>
        ok(next, { id: paymentId }),
      ),
    ),

  addCardItem: (cardId: string, input: fin.CardItemInput, meta: WriteMeta = {}) =>
    run(
      deps,
      'invoice.item.create',
      { cardId, input },
      meta,
      (data, ctx) =>
        lift(fin.addCardItem(data, cardId, input, ctx.today, ctx.newId), (v) =>
          ok(
            v.data,
            v.created.map((i) => i.id),
          ),
        ),
      {
        status: 201,
        respond: (okResult, after) => ({
          items: (okResult.result as string[]).map((id) => pick(after.card_items, id)),
        }),
      },
    ),

  deleteCardItem: (itemId: string, meta: WriteMeta = {}) =>
    run(deps, 'invoice.item.delete', { itemId }, meta, (data) =>
      lift(fin.deleteCardItem(data, itemId), (next) => ok(next, { id: itemId })),
    ),

  moveToInvoice: (
    origin: 'entry' | 'item',
    id: string,
    invoiceMonth: string,
    meta: WriteMeta = {},
  ) =>
    run(deps, 'invoice.move', { origin, id, invoiceMonth }, meta, (data) =>
      lift(fin.moveToInvoice(data, origin, id, invoiceMonth), (next) => ok(next, { id })),
    ),

  // ─── Rotina diária (worker e "sincronizar agora") ───────────────────────────
  syncDaily: (meta: WriteMeta = {}) =>
    run(deps, 'finance.sync', {}, meta, (data, ctx) => {
      const next = fin.syncRecurring(data, ctx.today, ctx.newId);
      return success(ok(next, { date: ctx.today }));
    }),
});

export type FinanceUseCases = ReturnType<typeof financeUseCases>;
export { toFinanceError };
export type { FinanceDeps, FinanceOutcome };
export { resolveRange };
export const financeNotFound = (what: string): NotFoundError =>
  new NotFoundError(`${what} não encontrado`);
