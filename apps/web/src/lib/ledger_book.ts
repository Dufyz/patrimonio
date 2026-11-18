import type { BookResponse, BookRowResource } from '@patrimonio/contracts';
import { ALL_SCOPE } from './scope.js';
import { routes } from './routes.js';

/**
 * LAN-01 · O que a tela Lançamentos decide sobre as linhas do livro.
 *
 * O valor vem sempre positivo e o sinal vem do tipo (RN-U1). Receita e
 * rendimentos entram (+); despesa e aporte saem (−); resgate e provento mudam
 * a posição, não o saldo do mês; transferência e evento não têm sinal.
 */
export type Sign = '+' | '-' | '';

const SIGN: Readonly<Record<BookRowResource['kind'], Sign>> = {
  RECEITA: '+',
  DESPESA: '-',
  APORTE: '-',
  PAGAMENTO_FATURA: '-',
  RESGATE: '+',
  PROVENTO: '+',
  TRANSFERENCIA: '',
  EVENTO: '',
};

export const signOf = (kind: BookRowResource['kind']): Sign => SIGN[kind];

/**
 * Aporte e resgate são duas movimentações: a do ativo na carteira e a da conta.
 * O aporte entra no ativo (+) e, se veio de uma conta, sai dela (−); o resgate
 * sai do ativo (−) e, se foi para uma conta, entra nela (+). Vindo de fora (ou
 * indo para fora), só existe a perna do ativo. Os totais continuam os do
 * servidor: aqui é só como a lista mostra cada perna.
 */
export const expandInvestmentLegs = (
  rows: readonly BookRowResource[],
): readonly BookRowResource[] =>
  rows.flatMap((row): BookRowResource[] => {
    if (row.side != null || (row.kind !== 'APORTE' && row.kind !== 'RESGATE')) {
      return [row];
    }
    const aporte = row.kind === 'APORTE';
    const asset: BookRowResource = { ...row, side: aporte ? 'entrada' : 'saida' };
    if (row.account_id === null) return [asset];
    const account: BookRowResource = {
      ...row,
      side: aporte ? 'saida' : 'entrada',
      description: `${row.description} · ${aporte ? 'saída da conta' : 'entrada na conta'}`,
    };
    return aporte ? [account, asset] : [asset, account];
  });

const WEEKDAYS = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;

/** `2026-11-11` → `Quarta, 11/11`. Sem fuso: a data é só calendário. */
export const dayLabel = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
  return `${weekday}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};

const SHORT_WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

/** `2026-11-11` → `qua, 11/11`; o dia de hoje leva "· hoje". */
export const dayHeading = (date: string, today: string): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = SHORT_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
  const base = `${weekday}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  return date === today ? `${base} · hoje` : base;
};

export type DaySection = {
  readonly date: string;
  readonly label: string;
  readonly rows: readonly BookRowResource[];
};

/** Mais novo primeiro; a ordem das linhas dentro do dia é a do servidor. */
export const sectionsByDay = (
  rows: readonly BookRowResource[],
): readonly DaySection[] => {
  const byDate = new Map<string, BookRowResource[]>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({ date, label: dayLabel(date), rows: list }));
};

/** O que a linha soma ao saldo do mês: só lançado; aporte só se sai de conta. */
export const countsInBalance = (row: BookRowResource): boolean =>
  row.situation === 'lancado' &&
  row.amount !== null &&
  (row.kind === 'RECEITA' ||
    row.kind === 'DESPESA' ||
    (row.kind === 'APORTE' && row.account_id !== null));

const SCALE = 8;

const toScaled = (value: string): bigint => {
  const negative = value.startsWith('-');
  const [int = '0', frac = ''] = value.replace(/^[+-]/, '').split('.');
  const scaled = BigInt(int + frac.padEnd(SCALE, '0').slice(0, SCALE));
  return negative ? -scaled : scaled;
};

/** Soma assinada da coluna Valor das linhas lançadas que entram no saldo. */
export const postedBalance = (rows: readonly BookRowResource[]): bigint =>
  rows.reduce((sum, row) => {
    if (!countsInBalance(row) || row.amount === null) return sum;
    const value = toScaled(row.amount);
    return signOf(row.kind) === '-' ? sum - value : sum + value;
  }, 0n);

/**
 * Sinal de uma linha como a lista mostra: a perna diz o sentido (entrada +,
 * saída −); sem perna, aporte e resgate seguem o ativo (aporte +, resgate −).
 */
export const legSign = (row: BookRowResource): Sign =>
  row.side === 'entrada'
    ? '+'
    : row.side === 'saida'
      ? '-'
      : row.kind === 'APORTE'
        ? '+'
        : row.kind === 'RESGATE'
          ? '-'
          : signOf(row.kind);

const fromScaled = (value: bigint): string => {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(SCALE + 1, '0');
  const int = digits.slice(0, -SCALE);
  const frac = digits.slice(-SCALE).replace(/0+$/, '');
  return `${negative ? '-' : ''}${int}${frac === '' ? '' : `.${frac}`}`;
};

/**
 * Efeito líquido das linhas lançadas no patrimônio, somando cada perna com o
 * sinal que a lista mostra: aporte de uma conta se anula (sai da conta, entra
 * no ativo); vindo de fora, soma.
 */
export const postedLegsNet = (rows: readonly BookRowResource[]): string =>
  fromScaled(
    expandInvestmentLegs(rows).reduce((sum, row) => {
      if (row.situation !== 'lancado' || row.amount === null) return sum;
      const sign = legSign(row);
      const value = toScaled(row.amount);
      return sign === '-' ? sum - value : sign === '+' ? sum + value : sum;
    }, 0n),
  );

/** O `saldo_do_mes` do servidor na mesma escala, para conferir a soma. */
export const balanceOf = (book: Pick<BookResponse, 'totals'>): bigint =>
  toScaled(book.totals.saldo_do_mes);

export type PlannedSection = {
  readonly rows: readonly BookRowResource[];
  readonly overdue: number;
  /** "3 previstos · 1 vencido"; sem vencidos, só a contagem. */
  readonly counter: string;
};

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

/** LAN-02 · Os previstos, do mais próximo ao mais distante; vencido é data < hoje. */
export const plannedSection = (
  rows: readonly BookRowResource[],
  today: string,
): PlannedSection => {
  const planned = rows
    .filter((r) => r.situation === 'previsto')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const overdue = planned.filter((r) => r.date < today).length;
  const base = plural(planned.length, 'previsto', 'previstos');
  return {
    rows: planned,
    overdue,
    counter: overdue === 0 ? base : `${base} · ${plural(overdue, 'vencido', 'vencidos')}`,
  };
};

/** "venceu em dd/mm" para o previsto cuja data já passou. */
export const overdueNote = (date: string, today: string): string | null =>
  date < today ? `venceu em ${date.slice(8)}/${date.slice(5, 7)}` : null;

/** LAN-03 · Eventos só aparecem com o filtro Tipo = Evento. */
export const visibleRows = (
  rows: readonly BookRowResource[],
  tipos: readonly string[],
): readonly BookRowResource[] =>
  tipos.includes('EVENTO') ? rows : rows.filter((r) => r.kind !== 'EVENTO');

export type DetailFormat = {
  readonly money: (value: string) => string;
  readonly quantity: (value: string) => string;
  /** Nome da conta pelo id; nulo quando não se conhece. */
  readonly accountName: (id: string) => string | null;
};

const isZero = (value: string | null): boolean =>
  value === null || /^[+-]?0+(\.0+)?$/.test(value);

/**
 * "80 × R$ 32,40 + taxas R$ 0,80 · de Nubank Conta" — ou "· Fora do app".
 * Resgate e provento dizem "para"; provento não tem quantidade. Linha que não é
 * de carteira não tem detalhe.
 */
export const detailOf = (row: BookRowResource, fmt: DetailFormat): string | null => {
  if (row.portfolio_id === null) return null;
  if (row.kind === 'EVENTO') return null;
  const parts: string[] = [];
  if (row.quantity !== null && row.unit_price !== null) {
    parts.push(`${fmt.quantity(row.quantity)} × ${fmt.money(row.unit_price)}`);
  }
  if (!isZero(row.fees)) parts.push(`+ taxas ${fmt.money(row.fees ?? '0')}`);
  const head = parts.join(' ');
  const preposition = row.kind === 'APORTE' ? 'de' : 'para';
  const where =
    row.account_id === null
      ? 'Fora do app'
      : `${preposition} ${fmt.accountName(row.account_id) ?? 'conta'}`;
  const base = head === '' ? where : `${head} · ${where}`;
  if (
    row.kind === 'APORTE' &&
    row.avg_price_before != null &&
    row.avg_price_after != null
  ) {
    return `${base} · PM ${fmt.money(row.avg_price_before)} → ${fmt.money(row.avg_price_after)}`;
  }
  return base;
};

export const GROUPINGS = ['dia', 'tipo', 'conta_carteira'] as const;
export type Grouping = (typeof GROUPINGS)[number];

export const GROUPING_LABEL: Readonly<Record<Grouping, string>> = {
  dia: 'Dia',
  tipo: 'Tipo',
  conta_carteira: 'Conta ou carteira',
};

/** A ordem das seções no agrupamento por tipo, como na prancha 2.2. */
export const KIND_ORDER: readonly BookRowResource['kind'][] = [
  'APORTE',
  'DESPESA',
  'RECEITA',
  'PROVENTO',
  'RESGATE',
  'TRANSFERENCIA',
  'PAGAMENTO_FATURA',
  'EVENTO',
];

type ApiGroup = NonNullable<BookResponse['groups']>[number];

export type GroupSection = {
  readonly key: string;
  readonly label: string;
  /** "conta", "cartão", "carteira": só no agrupamento por conta ou carteira. */
  readonly tag: string | null;
  /** Inclui os previstos (LAN-05, item 4). */
  readonly count: number;
  readonly rows: readonly BookRowResource[];
  /** Somas e efeito do grupo, calculados no servidor (RN-U16). */
  readonly sums: ApiGroup['sums'];
  readonly efeito: ApiGroup['efeito'];
  readonly flow: ApiGroup['flow'];
};

/** Previstos primeiro dentro do grupo; o resto na ordem do servidor. */
const plannedFirst = (rows: readonly BookRowResource[]): readonly BookRowResource[] => [
  ...rows.filter((r) => r.situation === 'previsto'),
  ...rows.filter((r) => r.situation !== 'previsto'),
];

export const sectionsOfGroups = (
  groups: NonNullable<BookResponse['groups']>,
  by: Grouping,
  kindLabel: (kind: string) => string,
  tipos: readonly string[],
): readonly GroupSection[] => {
  const shown = groups
    .map((g) => {
      // Por dia só o lançado entra na seção; o previsto tem a sua, no topo.
      const rows = visibleRows(
        by === 'dia' ? g.rows.filter((r) => r.situation === 'lancado') : g.rows,
        tipos,
      );
      return {
        key: g.key,
        label:
          by === 'tipo' ? kindLabel(g.key) : by === 'dia' ? dayLabel(g.key) : g.label,
        tag: g.tag,
        count: rows.length,
        rows: plannedFirst(rows),
        sums: g.sums,
        efeito: g.efeito,
        flow: g.flow,
      };
    })
    .filter((g) => g.count > 0);
  return by === 'tipo'
    ? [...shown].sort(
        (a, b) =>
          KIND_ORDER.indexOf(a.key as BookRowResource['kind']) -
          KIND_ORDER.indexOf(b.key as BookRowResource['kind']),
      )
    : shown;
};

/** LAN-08 · Só linha lançada é selecionável. */
export const selectable = (row: BookRowResource): boolean => row.situation === 'lancado';

/** Aporte, resgate, provento e evento só aceitam Excluir em lote. */
export const batchOnlyDelete = (rows: readonly BookRowResource[]): boolean =>
  rows.some((r) => ['APORTE', 'RESGATE', 'PROVENTO', 'EVENTO'].includes(r.kind));

export const EXPORT_HEADER = [
  'Data',
  'Descrição',
  'Tipo',
  'Situação',
  'Valor',
  'Conta',
  'Carteira',
  'Quantidade',
  'Preço',
  'Taxas',
] as const;

/** Números sem moeda e com ponto decimal; o valor leva o sinal do tipo. */
export const exportRows = (
  rows: readonly BookRowResource[],
  kindLabel: (kind: string) => string,
): readonly (readonly string[])[] => [
  [...EXPORT_HEADER],
  ...rows.map((r) => [
    r.date,
    r.description,
    kindLabel(r.kind),
    r.situation === 'previsto' ? 'Previsto' : 'Lançado',
    r.amount === null ? '' : `${signOf(r.kind) === '-' ? '-' : ''}${r.amount}`,
    r.account_id ?? '',
    r.portfolio_id ?? '',
    r.quantity ?? '',
    r.unit_price ?? '',
    r.fees ?? '',
  ]),
];

/**
 * LAN-03.5 · Para onde leva o ativo de uma linha de investimento: com carteira
 * filtrada, a página do ativo naquela carteira; em Todas, Posições filtrada
 * pelo código. O livro nomeia o ativo pelo código, sempre a última palavra da
 * descrição ("Aporte em ITUB4").
 */
export const assetTarget = (
  row: BookRowResource,
  portfolioFilter: readonly string[],
  slugs: ReadonlyMap<string, string>,
): string | null => {
  if (row.asset_id === null || row.portfolio_id === null) return null;

  const slug = slugs.get(row.portfolio_id);
  if (portfolioFilter.length > 0 && slug !== undefined) {
    return routes.asset(slug, row.asset_id);
  }

  const ticker = row.description.split(' ').at(-1) ?? '';
  const search = new URLSearchParams({ busca: ticker }).toString();
  return `${routes.portfolio(ALL_SCOPE, 'posicoes')}?${search}`;
};
