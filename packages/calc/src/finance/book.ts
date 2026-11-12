import { LEDGER_EFFECTS } from '@patrimonio/domain';
import type { FinEntry, FinSnapshot, LedgerKind } from '@patrimonio/domain';

import { compareDates, isDateInRange } from './dates.js';
import type { DateRange } from './dates.js';
import { ledgerPool } from './ledger.js';
import { findAccount, findCard, findCategory, sourceName } from './lookup.js';
import { dec, money, total } from './money.js';
import { looseAmount, matchesText } from './text.js';

/**
 * LIV-02 · A leitura unificada do livro.
 *
 * Não há tabela única de lançamentos: o livro é a união de Finanças (receitas,
 * despesas, transferências, pagamentos de fatura) com as movimentações de
 * carteira (aporte, resgate, provento, evento). Tudo aqui é função pura sobre
 * a foto de Finanças e as linhas de carteira que o repositório entrega, para
 * a tela e a exportação lerem o mesmo número (RN-U16).
 */

/** Uma movimentação de carteira como o repositório a entrega ao livro. */
export type BookInvestmentRow = {
  readonly id: string;
  readonly kind: 'buy' | 'sell' | 'payout' | 'corporate_event';
  readonly date: string;
  readonly portfolio_id: string;
  readonly portfolio_name: string;
  readonly asset_id: string;
  readonly asset_name: string;
  /** Classe do ativo (ex.: `acoes`), para o filtro por classe. */
  readonly asset_class: string | null;
  readonly quantity: string;
  readonly unit_price: string;
  readonly fees: string;
  /** Aporte e resgate: quantidade × preço ± taxas; provento: valor líquido. */
  readonly net_amount: string;
  readonly payout_kind: string | null;
  readonly event_ratio_from: string | null;
  readonly event_ratio_to: string | null;
  /** Liga a perna de posição à perna financeira. */
  readonly event_id: string | null;
};

export type BookSituation = 'previsto' | 'lancado';

export type BookRow = {
  readonly id: string;
  readonly kind: LedgerKind;
  readonly date: string;
  readonly situation: BookSituation;
  readonly description: string;
  /** Sempre positivo; o sinal vem do tipo. Evento não tem valor. */
  readonly amount: string | null;
  readonly account_id: string | null;
  /** Conta de destino, na transferência. */
  readonly to_account_id: string | null;
  readonly card_id: string | null;
  readonly category_id: string | null;
  readonly portfolio_id: string | null;
  readonly asset_id: string | null;
  readonly asset_class: string | null;
  readonly quantity: string | null;
  readonly unit_price: string | null;
  readonly fees: string | null;
  /** Despesa e receita guardam o lançamento de Finanças (pagamentos, parcelas). */
  readonly entry: FinEntry | null;
  readonly event_id: string | null;
};

const BLANK: Omit<BookRow, 'id' | 'kind' | 'date' | 'situation' | 'description'> = {
  amount: null,
  account_id: null,
  to_account_id: null,
  card_id: null,
  category_id: null,
  portfolio_id: null,
  asset_id: null,
  asset_class: null,
  quantity: null,
  unit_price: null,
  fees: null,
  entry: null,
  event_id: null,
};

const INVESTMENT_KIND: Readonly<Record<BookInvestmentRow['kind'], LedgerKind>> = {
  buy: 'APORTE',
  sell: 'RESGATE',
  payout: 'PROVENTO',
  corporate_event: 'EVENTO',
};

/** As pernas financeiras de carteira ficam fora: o livro mostra a linha da posição. */
const LEG_KINDS = new Set(['aporte', 'resgate', 'provento']);

const investmentDescription = (row: BookInvestmentRow): string => {
  switch (row.kind) {
    case 'buy':
      return `Aporte em ${row.asset_name}`;
    case 'sell':
      return `Resgate de ${row.asset_name}`;
    case 'payout':
      return `${
        row.payout_kind === 'jcp'
          ? 'JCP'
          : row.payout_kind === 'interest'
            ? 'Juros'
            : row.payout_kind === 'income'
              ? 'Rendimento'
              : 'Dividendo'
      } de ${row.asset_name}`;
    case 'corporate_event':
      return row.event_ratio_from === row.event_ratio_to
        ? `Custódia de ${row.asset_name}`
        : dec(row.event_ratio_to ?? '1').gt(row.event_ratio_from ?? '1')
          ? `Desdobramento de ${row.asset_name}`
          : `Grupamento de ${row.asset_name}`;
  }
};

/** O livro inteiro, sem filtro: Finanças mais carteira. */
export const bookRows = (
  data: FinSnapshot,
  investments: readonly BookInvestmentRow[],
): readonly BookRow[] => {
  const rows: BookRow[] = [];

  for (const entry of ledgerPool(data)) {
    const main = entry.payments[0];
    rows.push({
      ...BLANK,
      id: entry.id,
      kind: entry.kind === 'receita' ? 'RECEITA' : 'DESPESA',
      date: entry.date,
      situation: entry.status === 'lancada' ? 'lancado' : 'previsto',
      description: entry.description,
      amount: entry.amount,
      account_id: main?.source_type === 'conta' ? main.source_id : null,
      card_id: main?.source_type === 'cartao' ? main.source_id : null,
      category_id: entry.category_id,
      entry,
    });
  }

  // Uma linha por transferência, com as duas contas.
  const exits = data.movements.filter((m) => m.kind === 'transferencia_saida');
  for (const out of exits) {
    const entrance = data.movements.find(
      (m) => m.kind === 'transferencia_entrada' && m.transfer_id === out.transfer_id,
    );
    rows.push({
      ...BLANK,
      id: out.transfer_id ?? out.id,
      kind: 'TRANSFERENCIA',
      date: out.date,
      situation: 'lancado',
      description: out.description,
      amount: money(dec(out.amount).abs()),
      account_id: out.account_id,
      to_account_id: entrance?.account_id ?? null,
    });
  }

  for (const payment of data.invoice_payments) {
    if (!payment.posted) continue;
    rows.push({
      ...BLANK,
      id: payment.id,
      kind: 'PAGAMENTO_FATURA',
      date: payment.date,
      situation: 'lancado',
      description:
        `Pagamento da fatura ${findCard(data, payment.card_id)?.name ?? ''}`.trim(),
      amount: payment.amount,
      account_id: payment.account_id,
      card_id: payment.card_id,
    });
  }

  const legAccount = new Map<string, string>();
  for (const movement of data.movements) {
    if (LEG_KINDS.has(movement.kind) && movement.event_id) {
      legAccount.set(movement.event_id, movement.account_id);
    }
  }

  for (const row of investments) {
    const kind = INVESTMENT_KIND[row.kind];
    rows.push({
      ...BLANK,
      id: row.id,
      kind,
      date: row.date,
      situation: 'lancado',
      description: investmentDescription(row),
      amount: kind === 'EVENTO' ? null : money(dec(row.net_amount).abs()),
      account_id: row.event_id === null ? null : (legAccount.get(row.event_id) ?? null),
      portfolio_id: row.portfolio_id,
      asset_id: row.asset_id,
      asset_class: row.asset_class,
      quantity: row.quantity,
      unit_price: row.unit_price,
      fees: row.fees,
      event_id: row.event_id,
    });
  }

  return rows;
};

export type BookFilters = {
  readonly range: DateRange;
  readonly kinds?: readonly LedgerKind[] | undefined;
  readonly situations?: readonly BookSituation[] | undefined;
  readonly accounts?: readonly string[] | undefined;
  readonly cards?: readonly string[] | undefined;
  readonly portfolios?: readonly string[] | undefined;
  readonly assets?: readonly string[] | undefined;
  readonly categories?: readonly string[] | undefined;
  readonly classes?: readonly string[] | undefined;
  readonly q?: string | undefined;
};

const has = (list: readonly string[] | undefined): list is readonly string[] =>
  list !== undefined && list.length > 0;

/** Ordem estável: data (mais nova primeiro), previstos antes de lançados no dia, depois o id. */
export const byBookOrder = (a: BookRow, b: BookRow): number =>
  compareDates(b.date, a.date) ||
  (a.situation === b.situation ? 0 : a.situation === 'previsto' ? -1 : 1) ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const accountName = (data: FinSnapshot, id: string | null): string | undefined =>
  id === null ? undefined : findAccount(data, id)?.name;

export const filterBook = (
  data: FinSnapshot,
  rows: readonly BookRow[],
  filters: BookFilters,
): readonly BookRow[] => {
  const q = filters.q?.trim() ?? '';
  const amount = q === '' ? null : looseAmount(q);
  // Evento só aparece quando o filtro de tipo o pede (LIV-06).
  const wantsEvents = filters.kinds?.includes('EVENTO') === true;

  return rows
    .filter((row) => {
      if (!isDateInRange(row.date, filters.range)) return false;
      if (row.kind === 'EVENTO' && !wantsEvents) return false;
      if (has(filters.kinds) && !filters.kinds.includes(row.kind)) return false;
      if (has(filters.situations) && !filters.situations.includes(row.situation))
        return false;
      if (has(filters.accounts)) {
        const hit = [row.account_id, row.to_account_id].some(
          (id) => id !== null && filters.accounts?.includes(id),
        );
        const viaPayment =
          row.entry?.payments.some(
            (p) => p.source_type === 'conta' && filters.accounts?.includes(p.source_id),
          ) === true;
        if (!hit && !viaPayment) return false;
      }
      if (has(filters.cards)) {
        const viaPayment =
          row.entry?.payments.some(
            (p) => p.source_type === 'cartao' && filters.cards?.includes(p.source_id),
          ) === true;
        if (!(row.card_id !== null && filters.cards.includes(row.card_id)) && !viaPayment)
          return false;
      }
      if (has(filters.portfolios)) {
        if (row.portfolio_id === null || !filters.portfolios.includes(row.portfolio_id))
          return false;
      }
      if (has(filters.assets)) {
        if (row.asset_id === null || !filters.assets.includes(row.asset_id)) return false;
      }
      if (has(filters.categories)) {
        if (row.category_id === null || !filters.categories.includes(row.category_id))
          return false;
      }
      if (has(filters.classes)) {
        if (row.asset_class === null || !filters.classes.includes(row.asset_class))
          return false;
      }
      if (q !== '') {
        const textual = matchesText(q, [
          row.description,
          row.category_id === null
            ? undefined
            : findCategory(data, row.category_id)?.name,
          accountName(data, row.account_id),
          accountName(data, row.to_account_id),
          ...(row.entry?.payments.map((p) =>
            sourceName(data, { type: p.source_type, id: p.source_id }),
          ) ?? []),
        ]);
        const byAmount =
          amount !== null &&
          row.amount !== null &&
          (dec(row.amount).eq(amount) ||
            row.entry?.payments.some((p) => dec(p.amount).eq(amount)) === true);
        if (!textual && !byAmount) return false;
      }
      return true;
    })
    .sort(byBookOrder);
};

export type BookTotals = {
  readonly receitas: string;
  readonly despesas: string;
  readonly aportes: string;
  /** Receitas − Despesas − Aportes, só do lançado (RN-U1). */
  readonly saldo_do_mes: string;
  /** Previsto ainda por lançar, por tipo que entra na cascata. */
  readonly previsto: {
    readonly receitas: string;
    readonly despesas: string;
    readonly aportes: string;
  };
  /** Quantas linhas previstas faltam lançar. */
  readonly a_lancar: number;
};

/**
 * Os totais do período, sobre as linhas já filtradas — por isso respeitam os
 * filtros ativos e não dependem da página. Só entra na soma o tipo que a matriz
 * `LEDGER_EFFECTS` manda entrar; aporte entra quando sai de uma conta (origem
 * "Fora do app" muda só a posição, RN-U7).
 */
export const bookTotals = (rows: readonly BookRow[]): BookTotals => {
  const counted = (situation: BookSituation) =>
    rows.filter(
      (r) => r.situation === situation && (r.kind !== 'APORTE' || r.account_id !== null),
    );
  const posted = counted('lancado');
  const planned = counted('previsto');
  const flag = (kind: LedgerKind, key: 'receitas' | 'despesas' | 'aportes'): boolean =>
    LEDGER_EFFECTS[kind][key];
  const pick = (list: readonly BookRow[], key: 'receitas' | 'despesas' | 'aportes') =>
    list.filter((r) => flag(r.kind, key));

  const receitas = total(pick(posted, 'receitas').map((r) => dec(r.amount ?? '0')));
  const despesas = total(pick(posted, 'despesas').map((r) => dec(r.amount ?? '0')));
  const aportes = total(pick(posted, 'aportes').map((r) => dec(r.amount ?? '0')));

  return {
    receitas: money(receitas),
    despesas: money(despesas),
    aportes: money(aportes),
    saldo_do_mes: money(receitas.minus(despesas).minus(aportes)),
    previsto: {
      receitas: money(total(pick(planned, 'receitas').map((r) => dec(r.amount ?? '0')))),
      despesas: money(total(pick(planned, 'despesas').map((r) => dec(r.amount ?? '0')))),
      aportes: money(total(pick(planned, 'aportes').map((r) => dec(r.amount ?? '0')))),
    },
    a_lancar: rows.filter((r) => r.situation === 'previsto').length,
  };
};

export type BookGroupBy = 'dia' | 'tipo' | 'conta_carteira';

export type BookGroup = {
  readonly key: string;
  readonly label: string;
  readonly totals: BookTotals;
  readonly count: number;
  readonly rows: readonly BookRow[];
};

const groupOf = (
  data: FinSnapshot,
  portfolioNames: ReadonlyMap<string, string>,
  row: BookRow,
  by: BookGroupBy,
): { key: string; label: string } => {
  if (by === 'dia') return { key: row.date, label: row.date };
  if (by === 'tipo') return { key: row.kind, label: row.kind };
  if (row.portfolio_id !== null) {
    return {
      key: `carteira:${row.portfolio_id}`,
      label: portfolioNames.get(row.portfolio_id) ?? row.portfolio_id,
    };
  }
  const id = row.account_id ?? row.card_id;
  return id === null
    ? { key: '-', label: 'Sem conta' }
    : { key: id, label: accountName(data, id) ?? findCard(data, id)?.name ?? id };
};

/** Agrupa; o resumo de cada grupo vem do mesmo `bookTotals`. */
export const groupBook = (
  data: FinSnapshot,
  rows: readonly BookRow[],
  by: BookGroupBy,
  portfolioNames: ReadonlyMap<string, string> = new Map(),
): readonly BookGroup[] => {
  const order: string[] = [];
  const members = new Map<string, { label: string; rows: BookRow[] }>();
  for (const row of rows) {
    const { key, label } = groupOf(data, portfolioNames, row, by);
    let group = members.get(key);
    if (group === undefined) {
      group = { label, rows: [] };
      members.set(key, group);
      order.push(key);
    }
    group.rows.push(row);
  }
  return order
    .map((key) => {
      const group = members.get(key) as { label: string; rows: BookRow[] };
      return {
        key,
        label: group.label,
        totals: bookTotals(group.rows),
        count: group.rows.length,
        rows: group.rows,
      };
    })
    .sort((a, b) =>
      by === 'dia' ? compareDates(b.key, a.key) : a.label.localeCompare(b.label, 'pt-BR'),
    );
};

export type BookPage = {
  readonly rows: readonly BookRow[];
  readonly next_cursor: string | null;
};

export const encodeBookCursor = (row: BookRow): string =>
  Buffer.from(`${row.date}|${row.situation}|${row.id}`).toString('base64url');

const decodeBookCursor = (
  cursor: string,
): { date: string; situation: BookSituation; id: string } | null => {
  const [date, situation, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  return date !== undefined &&
    id !== undefined &&
    (situation === 'previsto' || situation === 'lancado')
    ? { date, situation, id }
    : null;
};

/** Paginação por cursor sobre a lista já ordenada; os totais não dependem da página. */
export const paginateBook = (
  rows: readonly BookRow[],
  cursor: string | undefined,
  limit: number,
): BookPage => {
  const after = cursor === undefined ? null : decodeBookCursor(cursor);
  const start =
    after === null
      ? 0
      : rows.findIndex(
          (row) =>
            byBookOrder(
              { ...row, date: after.date, situation: after.situation, id: after.id },
              row,
            ) < 0,
        );
  const from = start === -1 ? rows.length : start;
  const page = rows.slice(from, from + limit);
  const last = page.at(-1);
  return {
    rows: page,
    next_cursor:
      from + limit < rows.length && last !== undefined ? encodeBookCursor(last) : null,
  };
};
