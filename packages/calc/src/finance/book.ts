import { LEDGER_EFFECTS } from '@patrimonio/domain';
import type { Decimal } from 'decimal.js';
import type { FinEntry, FinSnapshot, LedgerKind } from '@patrimonio/domain';

import { compareDates, isDateInRange, monthKey, shiftMonthKey } from './dates.js';
import type { DateRange } from './dates.js';
import { ledgerPool } from './ledger.js';
import { findAccount, findCard, findCategory, sourceName } from './lookup.js';
import { dec, money, total } from './money.js';
import { plannedAportes } from './recurring.js';
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
  /** Preço médio da posição antes e depois do aporte; nulo se o dia tem mais de um lançamento do ativo. */
  readonly avg_price_before?: string | null | undefined;
  readonly avg_price_after?: string | null | undefined;
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
  /** LAN-03: "PM R$ 31,20 → R$ 31,45" no aporte. */
  readonly avg_price_before?: string | null | undefined;
  readonly avg_price_after?: string | null | undefined;
  /**
   * Só nas linhas de um grupo por conta ou carteira: de que lado o dinheiro passa
   * por aquele grupo. O aporte sai da conta e entra na carteira; o mesmo lançamento
   * aparece nos dois grupos, cada um com o seu lado.
   */
  readonly side?: 'entrada' | 'saida' | null | undefined;
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
  range?: DateRange,
): readonly BookRow[] => {
  const rows: BookRow[] = [];

  // LIV-11 · O aporte previsto de cada recorrente de aporte ativo, um por mês do
  // intervalo que ainda não foi lançado nem pulado. A linha leva o recorrente no
  // `id` para o "Lançar" abrir o modal de aporte já preenchido.
  if (range !== undefined) {
    const last = monthKey(range.to);
    for (
      let month = monthKey(range.from);
      month <= last;
      month = shiftMonthKey(month, 1)
    ) {
      for (const item of plannedAportes(data, month)) {
        rows.push({
          ...BLANK,
          id: `previsto-aporte:${item.recurring_id}:${month}`,
          kind: 'APORTE',
          date: item.date,
          situation: 'previsto',
          description: item.name,
          amount: item.amount,
          account_id: item.account_id,
          portfolio_id: item.portfolio_id,
          asset_id: item.asset_id,
        });
      }
    }
  }

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
      avg_price_before: kind === 'APORTE' ? (row.avg_price_before ?? null) : null,
      avg_price_after: kind === 'APORTE' ? (row.avg_price_after ?? null) : null,
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
  /** Do total de despesas lançadas, a parte de categorias de natureza fixa (CAT-04). */
  readonly despesas_fixas: string;
  /** O resto: natureza livre ou categoria sem natureza. `fixas + livres = despesas`. */
  readonly despesas_livres: string;
  readonly aportes: string;
  /** Dos aportes, os que vieram de fora do app: entram na carteira sem sair de conta. */
  readonly aportes_de_fora: string;
  /** Receitas − Despesas − Aportes de contas, só do lançado (RN-U1). */
  readonly saldo_do_mes: string;
  /** O que sai da conta no lançado: despesas + aportes. */
  readonly sai_da_conta: string;
  /** Efeito líquido dos previstos no caixa: entradas menos saídas, com o pagamento de fatura. */
  readonly a_lancar_efeito: string;
  /** Previsto ainda por lançar, por tipo que entra na cascata. */
  readonly previsto: {
    readonly receitas: string;
    readonly despesas: string;
    readonly despesas_fixas: string;
    readonly despesas_livres: string;
    readonly aportes: string;
    readonly aportes_de_fora: string;
  };
  /**
   * O mês inteiro como se fecharia: lançado mais o que ainda falta lançar. É a
   * coluna "Previsto no mês" da cascata, e `saldo_do_mes` dela é a conta feita
   * aqui, não na tela.
   */
  readonly projetado: {
    readonly receitas: string;
    readonly despesas: string;
    readonly despesas_fixas: string;
    readonly despesas_livres: string;
    readonly aportes: string;
    readonly aportes_de_fora: string;
    readonly saldo_do_mes: string;
  };
  /**
   * Aportes ÷ receitas, em pontos percentuais com uma casa ("22.9"). Nulo
   * quando não há receita: dividir por zero não é resposta.
   */
  readonly taxa_aporte: {
    readonly lancada: string | null;
    readonly prevista: string | null;
  };
  /** Quantas linhas previstas faltam lançar. */
  readonly a_lancar: number;
};

/** A natureza de uma despesa, lida da categoria dela; sem categoria ou sem natureza é livre. */
export type RowNature = (row: BookRow) => 'fixa' | 'livre';

const ALL_FREE: RowNature = () => 'livre';

/** CAT-04 · A natureza de cada linha pela categoria que o lançamento carrega. */
export const rowNatureOf =
  (data: FinSnapshot): RowNature =>
  (row) =>
    row.category_id !== null && findCategory(data, row.category_id)?.nature === 'fixa'
      ? 'fixa'
      : 'livre';

const rate = (part: Decimal, whole: Decimal): string | null =>
  whole.lte(0) ? null : part.times(100).div(whole).toDecimalPlaces(1).toFixed(1);

/** Sinal do tipo no caixa: entradas somam, saídas subtraem; transferência e evento não mudam o total. */
const EFFECT_SIGN: Readonly<Record<LedgerKind, 1 | -1 | 0>> = {
  RECEITA: 1,
  DESPESA: -1,
  APORTE: -1,
  PAGAMENTO_FATURA: -1,
  RESGATE: 1,
  PROVENTO: 1,
  TRANSFERENCIA: 0,
  EVENTO: 0,
};

/** Efeito líquido das linhas, com o sinal do tipo (aporte de fora do app não sai de conta). */
export const netEffect = (rows: readonly BookRow[]): Decimal =>
  rows.reduce((sum, row) => {
    if (row.amount === null) return sum;
    if (row.kind === 'APORTE' && row.account_id === null) return sum;
    const sign = EFFECT_SIGN[row.kind];
    return sign === 0 ? sum : sign === 1 ? sum.plus(row.amount) : sum.minus(row.amount);
  }, dec('0'));

/**
 * Os totais do período, sobre as linhas já filtradas — por isso respeitam os
 * filtros ativos e não dependem da página. Só entra na soma o tipo que a matriz
 * `LEDGER_EFFECTS` manda entrar. Aportes são as compras de ativos nas carteiras,
 * de uma conta ou de fora do app; o saldo do mês e o que sai da conta só
 * descontam os que saíram de uma conta: o de fora muda só a posição (RN-U7).
 */
export const bookTotals = (
  rows: readonly BookRow[],
  natureOf: RowNature = ALL_FREE,
): BookTotals => {
  const counted = (situation: BookSituation) =>
    rows.filter((r) => r.situation === situation);
  const posted = counted('lancado');
  const planned = counted('previsto');
  const flag = (kind: LedgerKind, key: 'receitas' | 'despesas' | 'aportes'): boolean =>
    LEDGER_EFFECTS[kind][key];
  const pick = (list: readonly BookRow[], key: 'receitas' | 'despesas' | 'aportes') =>
    list.filter((r) => flag(r.kind, key));
  const sum = (list: readonly BookRow[]): Decimal =>
    total(list.map((r) => dec(r.amount ?? '0')));
  const split = (list: readonly BookRow[]) => {
    const expenses = pick(list, 'despesas');
    return {
      all: sum(expenses),
      fixas: sum(expenses.filter((r) => natureOf(r) === 'fixa')),
      livres: sum(expenses.filter((r) => natureOf(r) !== 'fixa')),
    };
  };

  const receitas = sum(pick(posted, 'receitas'));
  const despesas = split(posted);
  // Aporte é a compra de ativo na carteira, venha de uma conta ou de fora do
  // app. O saldo do mês só desconta o que saiu de uma conta (RN-U7).
  const outside = (list: readonly BookRow[]): Decimal =>
    sum(pick(list, 'aportes').filter((r) => r.account_id === null));
  const aportes = sum(pick(posted, 'aportes'));
  const aportesFora = outside(posted);
  const previstoReceitas = sum(pick(planned, 'receitas'));
  const previstoDespesas = split(planned);
  const previstoAportes = sum(pick(planned, 'aportes'));
  const previstoFora = outside(planned);

  const projetadoReceitas = receitas.plus(previstoReceitas);
  const projetadoDespesas = despesas.all.plus(previstoDespesas.all);
  const projetadoAportes = aportes.plus(previstoAportes);
  const projetadoFora = aportesFora.plus(previstoFora);

  return {
    receitas: money(receitas),
    despesas: money(despesas.all),
    despesas_fixas: money(despesas.fixas),
    despesas_livres: money(despesas.livres),
    aportes: money(aportes),
    aportes_de_fora: money(aportesFora),
    saldo_do_mes: money(receitas.minus(despesas.all).minus(aportes.minus(aportesFora))),
    sai_da_conta: money(despesas.all.plus(aportes.minus(aportesFora))),
    a_lancar_efeito: money(netEffect(rows.filter((r) => r.situation === 'previsto'))),
    previsto: {
      receitas: money(previstoReceitas),
      despesas: money(previstoDespesas.all),
      despesas_fixas: money(previstoDespesas.fixas),
      despesas_livres: money(previstoDespesas.livres),
      aportes: money(previstoAportes),
      aportes_de_fora: money(previstoFora),
    },
    projetado: {
      receitas: money(projetadoReceitas),
      despesas: money(projetadoDespesas),
      despesas_fixas: money(despesas.fixas.plus(previstoDespesas.fixas)),
      despesas_livres: money(despesas.livres.plus(previstoDespesas.livres)),
      aportes: money(projetadoAportes),
      aportes_de_fora: money(projetadoFora),
      saldo_do_mes: money(
        projetadoReceitas
          .minus(projetadoDespesas)
          .minus(projetadoAportes.minus(projetadoFora)),
      ),
    },
    taxa_aporte: {
      lancada: rate(aportes, receitas),
      prevista: rate(projetadoAportes, projetadoReceitas),
    },
    a_lancar: rows.filter((r) => r.situation === 'previsto').length,
  };
};

export type BookGroupBy = 'dia' | 'tipo' | 'conta_carteira';

export type BookGroup = {
  readonly key: string;
  readonly label: string;
  /** Rótulo pequeno depois do nome: "conta", "cartão", "carteira", "benefício". Só por conta ou carteira. */
  readonly tag: string | null;
  readonly totals: BookTotals;
  readonly count: number;
  readonly rows: readonly BookRow[];
  /** Soma dos valores (sem sinal) das linhas lançadas e das previstas do grupo. */
  readonly sums: { readonly lancado: string; readonly previsto: string };
  /** Efeito líquido, com o sinal do tipo, das linhas lançadas e das previstas. */
  readonly efeito: { readonly lancado: string; readonly previsto: string };
  /** Por conta ou carteira: o que entrou e o que saiu pelo grupo, só do lançado. */
  readonly flow: { readonly entradas: string; readonly saidas: string } | null;
};

type Membership = {
  readonly key: string;
  readonly label: string;
  readonly tag: string | null;
  readonly rank: number;
  readonly side: 'entrada' | 'saida' | null;
  readonly amount: string | null;
};

/**
 * Os grupos de conta ou carteira em que uma linha aparece. O aporte aparece nas
 * duas pontas (sai da conta, entra na carteira), a transferência nas duas contas
 * e o pagamento de fatura na conta e no cartão; a despesa em duas origens aparece
 * em cada uma com a sua parte.
 */
const membershipsOf = (
  data: FinSnapshot,
  portfolioNames: ReadonlyMap<string, string>,
  row: BookRow,
): readonly Membership[] => {
  const out: Membership[] = [];
  const account = (
    id: string | null,
    side: Membership['side'],
    amount: string | null,
  ) => {
    if (id === null) return;
    const index = data.accounts.findIndex((a) => a.id === id);
    if (index >= 0) {
      const found = data.accounts[index];
      out.push({
        key: id,
        label: found?.name ?? id,
        tag: found?.role_tag?.toLowerCase() ?? 'conta',
        rank: index,
        side,
        amount,
      });
      return;
    }
    const cardIndex = data.cards.findIndex((c) => c.id === id);
    out.push({
      key: id,
      label: findCard(data, id)?.name ?? id,
      tag: 'cartão',
      rank: 1000 + Math.max(0, cardIndex),
      side,
      amount,
    });
  };
  const portfolio = (side: Membership['side']) => {
    if (row.portfolio_id === null) return;
    const names = [...portfolioNames.keys()];
    out.push({
      key: `carteira:${row.portfolio_id}`,
      label: portfolioNames.get(row.portfolio_id) ?? row.portfolio_id,
      tag: 'carteira',
      rank: 2000 + Math.max(0, names.indexOf(row.portfolio_id)),
      side,
      amount: row.amount,
    });
  };

  switch (row.kind) {
    case 'RECEITA':
      account(row.account_id, 'entrada', row.amount);
      break;
    case 'DESPESA': {
      const payments = row.entry?.payments ?? [];
      if (payments.length === 0) {
        account(row.account_id ?? row.card_id, 'saida', row.amount);
      } else {
        for (const payment of payments)
          account(payment.source_id, 'saida', payment.amount);
      }
      break;
    }
    case 'TRANSFERENCIA':
      account(row.account_id, 'saida', row.amount);
      account(row.to_account_id, 'entrada', row.amount);
      break;
    case 'PAGAMENTO_FATURA':
      account(row.account_id, 'saida', row.amount);
      account(row.card_id, 'entrada', row.amount);
      break;
    case 'APORTE':
      account(row.account_id, 'saida', row.amount);
      portfolio('entrada');
      break;
    case 'RESGATE':
      portfolio('saida');
      account(row.account_id, 'entrada', row.amount);
      break;
    case 'PROVENTO':
      if (row.account_id === null) portfolio('entrada');
      else account(row.account_id, 'entrada', row.amount);
      break;
    case 'EVENTO':
      portfolio(null);
      break;
  }
  if (out.length === 0) {
    out.push({
      key: '-',
      label: 'Sem conta',
      tag: null,
      rank: 3000,
      side: null,
      amount: row.amount,
    });
  }
  return out;
};

const groupOf = (
  row: BookRow,
  by: Exclude<BookGroupBy, 'conta_carteira'>,
): { key: string; label: string } =>
  by === 'dia' ? { key: row.date, label: row.date } : { key: row.kind, label: row.kind };

/** Agrupa; o resumo de cada grupo vem do mesmo `bookTotals`. */
export const groupBook = (
  data: FinSnapshot,
  rows: readonly BookRow[],
  by: BookGroupBy,
  portfolioNames: ReadonlyMap<string, string> = new Map(),
): readonly BookGroup[] => {
  const order: string[] = [];
  const members = new Map<
    string,
    { label: string; tag: string | null; rank: number; rows: BookRow[] }
  >();
  const place = (
    key: string,
    label: string,
    tag: string | null,
    rank: number,
    row: BookRow,
  ): void => {
    let group = members.get(key);
    if (group === undefined) {
      group = { label, tag, rank, rows: [] };
      members.set(key, group);
      order.push(key);
    }
    group.rows.push(row);
  };

  for (const row of rows) {
    if (by === 'conta_carteira') {
      for (const m of membershipsOf(data, portfolioNames, row)) {
        place(m.key, m.label, m.tag, m.rank, { ...row, amount: m.amount, side: m.side });
      }
    } else {
      const { key, label } = groupOf(row, by);
      place(key, label, null, 0, row);
    }
  }

  const sumOf = (list: readonly BookRow[]): string =>
    money(total(list.map((r) => dec(r.amount ?? '0'))));
  const flowOf = (list: readonly BookRow[], side: 'entrada' | 'saida'): string =>
    money(
      total(
        list
          .filter((r) => r.situation === 'lancado' && r.side === side)
          .map((r) => dec(r.amount ?? '0')),
      ),
    );

  return order
    .map((key) => {
      const group = members.get(key) as {
        label: string;
        tag: string | null;
        rank: number;
        rows: BookRow[];
      };
      const posted = group.rows.filter((r) => r.situation === 'lancado');
      const planned = group.rows.filter((r) => r.situation === 'previsto');
      return {
        key,
        rank: group.rank,
        label: group.label,
        tag: group.tag,
        totals: bookTotals(group.rows, rowNatureOf(data)),
        count: group.rows.length,
        rows: group.rows,
        sums: { lancado: sumOf(posted), previsto: sumOf(planned) },
        efeito: {
          lancado: money(netEffect(posted)),
          previsto: money(netEffect(planned)),
        },
        flow:
          by === 'conta_carteira'
            ? {
                entradas: flowOf(group.rows, 'entrada'),
                saidas: flowOf(group.rows, 'saida'),
              }
            : null,
      };
    })
    .sort((a, b) =>
      by === 'dia'
        ? compareDates(b.key, a.key)
        : by === 'conta_carteira'
          ? a.rank - b.rank || a.label.localeCompare(b.label, 'pt-BR')
          : a.label.localeCompare(b.label, 'pt-BR'),
    )
    .map(({ rank: _rank, ...group }) => group);
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

export type FlowMonth = {
  readonly month: string;
  readonly receitas: string;
  readonly despesas: string;
  readonly aportes: string;
  /** Lançado + previsto do mês: o que o mês fecharia. */
  readonly projetado: {
    readonly receitas: string;
    readonly despesas: string;
    readonly aportes: string;
  };
};

/**
 * Receitas, despesas e aportes de cada mês, do mesmo livro e das mesmas regras
 * da cascata (RN-U16): o gráfico Receitas × despesas não soma por conta própria.
 */
export const flowSeries = (
  rows: readonly BookRow[],
  months: readonly string[],
  natureOf: RowNature = ALL_FREE,
): readonly FlowMonth[] =>
  months.map((month) => {
    const totals = bookTotals(
      rows.filter((row) => row.date.slice(0, 7) === month),
      natureOf,
    );
    return {
      month,
      receitas: totals.receitas,
      despesas: totals.despesas,
      aportes: totals.aportes,
      projetado: {
        receitas: totals.projetado.receitas,
        despesas: totals.projetado.despesas,
        aportes: totals.projetado.aportes,
      },
    };
  });
