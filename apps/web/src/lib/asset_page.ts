import type { AssetPageResource, AssetPeriod } from '@patrimonio/contracts';
import type { TransactionKind } from '@patrimonio/domain';

import { formatShortDate, indexerLabel } from './positions.js';

/**
 * T-03 · Tudo que a página do ativo decide sem precisar de navegador.
 *
 * A divisão é a do resto de `web`: regra aqui, com teste; desenho no
 * componente. O que mora neste arquivo é o que erraria em silêncio — como a
 * janela vira URL e volta, que nome o papel usa, que linha o bloco de renda
 * fixa mostra, e quando a tela diz "posição zerada" em vez de mostrar seis
 * zeros.
 *
 * Nada aqui soma dinheiro. O que estas funções fazem com os números da `api` é
 * mudá-los de forma, não de valor.
 */

/**
 * A janela na URL é em português, pela razão de T-02: a URL é lida por gente, e
 * `/longo-prazo/ativo/itub4?janela=3a` é um endereço que alguém cola. A tradução
 * para o campo da `api` é esta tabela, e ela é a única.
 */
export const PERIOD_PARAM = {
  '6m': '6m',
  '1a': '1a',
  '3a': '3a',
  tudo: 'tudo',
} as const satisfies Readonly<Record<string, AssetPeriod>>;

export type PeriodParam = keyof typeof PERIOD_PARAM;

export const PERIOD_PARAMS = Object.keys(PERIOD_PARAM) as readonly PeriodParam[];

export const DEFAULT_ASSET_PERIOD: PeriodParam = '1a';

export const isPeriodParam = (value: unknown): value is PeriodParam =>
  typeof value === 'string' && (PERIOD_PARAMS as readonly string[]).includes(value);

/** Os botões da janela, na ordem da prancha 06. */
export const PERIOD_OPTIONS: readonly { value: PeriodParam; label: string }[] = [
  { value: '6m', label: '6M' },
  { value: '1a', label: '1A' },
  { value: '3a', label: '3A' },
  { value: 'tudo', label: 'Tudo' },
];

/* -------------------------------------------------------------------------- */

/**
 * Como o papel se chama no título, pela mesma regra de Posições: ação, FII, ETF
 * e BDR se identificam pelo código, porque é por ele que se pede a ordem e é
 * ele que aparece na corretora. Tesouro, título de banco e caixa aparecem pelo
 * nome — `CDB-BANCOC-20280614` é chave de banco de dados, não nome de coisa.
 */
const TICKER_TYPES = ['stock', 'fii', 'etf', 'bdr'] as const;

/**
 * As três colunas de que o nome depende. Posições e a página do ativo leem
 * recursos diferentes do mesmo papel, e a regra de como ele se chama é uma só
 * — então ela recebe o mínimo que as duas têm em comum.
 */
export type AssetNaming = {
  readonly asset_id: string;
  readonly ticker: string;
  readonly name: string;
  readonly b3_type: string | null;
};

const hasTicker = (asset: AssetNaming): boolean =>
  asset.b3_type !== null && (TICKER_TYPES as readonly string[]).includes(asset.b3_type);

export const assetTitle = (asset: AssetNaming): string =>
  hasTicker(asset) ? asset.ticker : asset.name;

/**
 * O apelido do ativo na URL. Código quando ele tem um que alguém reconhece, e
 * o identificador quando não tem: um endereço com `cdb-prefixado-banco-c-2028`
 * seria bonito e ambíguo, porque dois CDBs do mesmo banco e vencimento são
 * possíveis.
 */
export const assetSlug = (asset: AssetNaming): string =>
  hasTicker(asset) ? asset.ticker.toLowerCase() : asset.asset_id;

/* -------------------------------------------------------------------------- */

export const TRANSACTION_KIND_LABELS: Readonly<Record<TransactionKind, string>> = {
  buy: 'Compra',
  sell: 'Venda',
  payout: 'Provento',
  deposit: 'Aporte',
  withdrawal: 'Resgate',
  corporate_event: 'Evento',
};

export const PAYOUT_KIND_LABELS: Readonly<Record<string, string>> = {
  dividend: 'Dividendo',
  jcp: 'JCP',
  income: 'Rendimento',
  interest: 'Juros',
  amortization: 'Amortização',
};

/**
 * O tom da pastilha de tipo. Dinheiro entrando é positivo, saindo é neutro e
 * venda é a única que se distingue por si — ela é a que realiza resultado.
 */
export const transactionTone = (
  kind: TransactionKind,
): 'positive' | 'accent' | 'muted' =>
  kind === 'payout' || kind === 'deposit'
    ? 'positive'
    : kind === 'sell'
      ? 'accent'
      : 'muted';

export const CORPORATE_EVENT_LABELS: Readonly<Record<string, string>> = {
  split: 'Desdobramento',
  reverse_split: 'Grupamento',
  bonus: 'Bonificação',
};

/** `1` para `2` → `1:2`, que é como o fator é lido e anunciado. */
export const eventRatioLabel = (from: string, to: string): string =>
  `${trimZeros(from)}:${trimZeros(to)}`;

const trimZeros = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;

/* -------------------------------------------------------------------------- */

export const LIQUIDITY_LABELS: Readonly<Record<string, string>> = {
  daily: 'diária',
  at_maturity: 'no vencimento',
  d_plus_n: 'D+',
};

/** `d_plus_n` com 30 dias → `D+30`; o resto sai da tabela. */
export const liquidityLabel = (
  liquidity: string | null,
  days: number | null,
): string | null => {
  if (liquidity === null) return null;
  if (liquidity === 'd_plus_n') return days === null ? 'D+n' : `D+${days}`;
  return LIQUIDITY_LABELS[liquidity] ?? liquidity;
};

export type Fact = { readonly label: string; readonly value: string };

/**
 * O bloco de renda fixa: indexador, taxa, vencimento, carência e regime de IR.
 *
 * Ele só existe quando o papel tem indexador. Mostrá-lo vazio numa ação seria
 * cinco traços dizendo que falta dado — e não falta: ação não tem indexador,
 * que é uma coisa diferente de ter e não saber.
 */
export const fixedIncomeFacts = (asset: AssetPageResource['asset']): readonly Fact[] => {
  if (asset.indexer === null) return [];

  const facts: Fact[] = [];
  const terms = indexerLabel(asset.indexer, asset.rate);
  if (terms !== null) facts.push({ label: 'Remuneração', value: terms });

  if (asset.issued_at !== null) {
    facts.push({ label: 'Aplicação', value: formatFullDate(asset.issued_at) });
  }
  if (asset.maturity_date !== null) {
    facts.push({ label: 'Vencimento', value: formatFullDate(asset.maturity_date) });
  }

  const liquidity = liquidityLabel(asset.liquidity, asset.liquidity_days);
  if (liquidity !== null) facts.push({ label: 'Carência', value: liquidity });

  if (asset.tax_regime !== null) {
    facts.push({
      label: 'Imposto',
      value: asset.tax_regime === 'exempt' ? 'isento' : 'tabela regressiva',
    });
  }

  if (asset.issuer_name !== null) {
    facts.push({ label: 'Emissor', value: asset.issuer_name });
  }

  return facts;
};

/** `2035-05-15` → `15/05/2035`. Vencimento mostra o ano inteiro, sempre. */
export const formatFullDate = (date: string): string => {
  const [year = '', month = '', day = ''] = date.split('-');
  return `${day}/${month}/${year}`;
};

/* -------------------------------------------------------------------------- */

/** `2026-09` → `set`, a letra única do eixo da prancha e o nome na dica. */
const MONTH_NAMES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

export const monthLabel = (month: string): string => {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTH_NAMES[index] ?? month;
};

/** O eixo da prancha é a inicial do mês: `O N D J F M A M J J A S`. */
export const monthInitial = (month: string): string =>
  monthLabel(month).slice(0, 1).toUpperCase();

/**
 * As fatias da grade de proventos, na ordem em que empilham. Uma fatia que não
 * aparece em mês nenhum sai da legenda: uma legenda com cinco entradas e duas
 * barras faz procurar o que não existe.
 */
export const PAYOUT_SLICES = [
  { id: 'dividend', label: 'Dividendos' },
  { id: 'jcp', label: 'JCP' },
  { id: 'income', label: 'Rendimentos' },
  { id: 'interest', label: 'Juros' },
  { id: 'amortization', label: 'Amortização' },
] as const;

export type PayoutSliceId = (typeof PAYOUT_SLICES)[number]['id'];

export const usedPayoutSlices = (
  months: AssetPageResource['payouts']['months'],
): readonly PayoutSliceId[] =>
  PAYOUT_SLICES.filter((slice) =>
    months.some((month) => Number(month[slice.id]) !== 0),
  ).map((slice) => slice.id);

/* -------------------------------------------------------------------------- */

/**
 * A ressalva de procedência, abaixo do preço do cabeçalho: de que dia é o
 * número e de onde ele veio. Sem fechamento ainda não há o que ressalvar.
 */
export const priceStamp = (resource: AssetPageResource): string | null => {
  if (resource.price.price_date === null) return null;

  const source =
    resource.price.price_health === 'manual'
      ? 'preço manual'
      : resource.price.price_health === 'missing'
        ? 'sem preço · usa o custo'
        : resource.asset.b3_type === null
          ? 'na curva'
          : 'B3';

  return `${source} ${formatShortDate(resource.price.price_date)}`;
};

/**
 * O estado em que a tela abre. Três são diferentes e dizer a frase errada manda
 * a pessoa procurar o problema no lugar errado (O-08): o papel que nunca teve
 * fechamento, o que tem histórico e saiu da carteira, e o que está em carteira.
 */
export type AssetState = 'held' | 'closed' | 'never_closed';

export const assetState = (resource: AssetPageResource): AssetState => {
  if (resource.position !== null) return 'held';
  return resource.as_of === null ? 'never_closed' : 'closed';
};

/**
 * Quantos lançamentos o rodapé da lista promete mostrar. O número é da `api`
 * com o filtro aplicado, e o link leva a Movimentações já filtrado por este
 * ativo — a lista daqui é curta de propósito.
 */
export const transactionsCountLabel = (total: number): string =>
  total === 1 ? '1 lançamento' : `${total} lançamentos`;

/** As opções do filtro de tipo, com a contagem de cada uma. */
export type KindOption = {
  readonly value: TransactionKind | null;
  readonly label: string;
  readonly count: number;
};

export const kindOptions = (
  facets: AssetPageResource['transactions']['facets'],
): readonly KindOption[] => [
  {
    value: null,
    label: 'Todos',
    count: facets.reduce((sum, facet) => sum + facet.count, 0),
  },
  ...facets.map((facet) => ({
    value: facet.kind,
    label: TRANSACTION_KIND_LABELS[facet.kind],
    count: facet.count,
  })),
];

/**
 * O que a coluna "Qtd × preço" mostra. Provento, aporte e resgate não têm
 * quantidade vezes preço — mostrar `0 × 0,00` neles seria dizer que a operação
 * foi de nada, e não que a coluna não se aplica.
 */
export const hasQuantityAndPrice = (kind: TransactionKind): boolean =>
  kind === 'buy' || kind === 'sell';
