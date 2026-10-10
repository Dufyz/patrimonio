import type {
  PositionGroup,
  PositionResource,
  PositionSummary,
  PositionsResource,
} from '@patrimonio/contracts';
import type { DateOnly, PositionGroupBy } from '@patrimonio/domain';

import { isZero, parseDecimal } from './decimal.js';
import { formatPercent, formatQuantity } from './format.js';
import type { GroupSummary, TableGroup } from './table/model.js';

/**
 * T-02 · Tudo que a tela de Posições decide sem precisar de navegador.
 *
 * A divisão é a mesma do resto de `web`: regra aqui, com teste; desenho no
 * componente. O que mora aqui é o que erraria em silêncio — qual texto a coluna
 * Detalhe mostra, que opção de agrupamento faz sentido no escopo, como o
 * recorte vira URL e volta.
 *
 * Nada aqui soma dinheiro. Subtotal, total, peso e contagem chegam prontos da
 * `api`; o que estas funções fazem com eles é mudá-los de forma, não de valor.
 */

/**
 * O agrupamento na URL é em português, porque a URL é lida por gente: a tela
 * compartilhada é `/longo-prazo/posicoes?agrupar=instituicao`. A `api` usa o
 * nome do campo; a tradução é esta tabela, e ela é a única.
 */
export const GROUP_BY_PARAM = {
  categoria: 'category',
  instituicao: 'institution',
  nenhum: 'none',
} as const satisfies Readonly<Record<string, PositionGroupBy>>;

export type GroupByParam = keyof typeof GROUP_BY_PARAM;

export const GROUP_BY_PARAMS = Object.keys(GROUP_BY_PARAM) as readonly GroupByParam[];

export const DEFAULT_GROUP_BY: GroupByParam = 'categoria';

export const toGroupBy = (param: GroupByParam): PositionGroupBy => GROUP_BY_PARAM[param];

export type GroupByOption = {
  readonly value: GroupByParam;
  readonly label: string;
};

/** As opções do seletor de agrupamento. */
export const groupByOptions: readonly GroupByOption[] = [
  { value: 'categoria', label: 'Categoria' },
  { value: 'instituicao', label: 'Instituição' },
  { value: 'nenhum', label: 'Sem grupo' },
];

export const isGroupByParam = (value: unknown): value is GroupByParam =>
  typeof value === 'string' && (GROUP_BY_PARAMS as readonly string[]).includes(value);

/* -------------------------------------------------------------------------- */

const INDEXER_PREFIX = {
  ipca_plus: 'IPCA +',
  selic_plus: 'Selic +',
  prefixed: 'Pré',
  cdi_pct: '',
} as const;

/** `ipca_plus` a 6,82 → `IPCA + 6,82%`; `cdi_pct` a 112 → `112% do CDI`. */
export const indexerLabel = (
  indexer: PositionResource['indexer'],
  rate: string | null,
): string | null => {
  if (indexer === null) return null;

  const amount = rate === null ? null : formatQuantity(rate, { decimals: 2 });
  if (amount === null || !amount.available) return null;

  return indexer === 'cdi_pct'
    ? `${amount.text}% do CDI`
    : `${INDEXER_PREFIX[indexer]} ${amount.text}%`;
};

/** `2035-05-15` → `15/05/2035`. Vencimento mostra o ano inteiro, sempre. */
export const formatFullDate = (date: DateOnly): string => {
  const [year = '', month = '', day = ''] = date.split('-');
  return `${day}/${month}/${year}`;
};

/** `2026-10-06` → `06/10`. */
export const formatShortDate = (date: DateOnly): string => {
  const [, month = '', day = ''] = date.split('-');
  return `${day}/${month}`;
};

export type PositionDetail = {
  readonly text: string;
  /** `attention` é a ressalva de preço, que não é informação neutra. */
  readonly tone: 'neutral' | 'attention';
};

/**
 * A coluna Detalhe, que é a mesma coluna dizendo coisas diferentes conforme o
 * papel. A ordem é de urgência, não de completude: a ressalva de preço vem na
 * frente de qualquer outra informação, porque ela é a única que muda a
 * confiança no número ao lado.
 */
export const positionDetail = (position: PositionResource): PositionDetail | null => {
  if (position.price_health === 'missing') {
    return { text: 'sem preço · usa o custo', tone: 'attention' };
  }

  if (position.price_health !== 'fresh' && position.price_date !== null) {
    const prefix = position.price_health === 'manual' ? 'preço manual de' : 'preço de';
    return {
      text: `${prefix} ${formatShortDate(position.price_date)}`,
      tone: 'attention',
    };
  }

  const terms = indexerLabel(position.indexer, position.rate);
  if (terms !== null) {
    return {
      text:
        position.maturity_date === null
          ? terms
          : `${terms} · ${formatFullDate(position.maturity_date)}`,
      tone: 'neutral',
    };
  }

  // Ausência de provento é ausência, não rendimento de zero: a `api` manda
  // nulo, e um zero que escape ainda assim não vira pastilha.
  const payouts =
    position.dividend_yield_12m === null
      ? null
      : parseDecimal(position.dividend_yield_12m);

  if (payouts !== null && !isZero(payouts)) {
    return {
      text: `DY ${formatPercent(position.dividend_yield_12m, { decimals: 1 }).text}`,
      tone: 'neutral',
    };
  }

  return null;
};

/* -------------------------------------------------------------------------- */

/**
 * Como a linha se chama na primeira coluna.
 *
 * Ação, FII, ETF e BDR se identificam pelo código: é por ele que se pede a
 * ordem e é ele que aparece na corretora. Tesouro, título de banco e caixa não
 * têm código que alguém reconheça — `CDB-BANCOC-20280614` é chave de banco de
 * dados, não nome de coisa —, e aparecem pelo nome, como a prancha 05 mostra.
 */
const TICKER_TYPES = ['stock', 'fii', 'etf', 'bdr'] as const;

export const positionTitle = (position: PositionResource): string =>
  position.b3_type !== null &&
  (TICKER_TYPES as readonly string[]).includes(position.b3_type)
    ? position.ticker
    : position.name;

/** A linha é única por carteira e ativo: o mesmo papel em duas carteiras são duas. */
export const positionId = (position: PositionResource): string =>
  `${position.portfolio_id}:${position.asset_id}`;

export const positionLabel = (position: PositionResource): string =>
  position.ticker === position.name
    ? position.name
    : `${position.ticker} · ${position.name}`;

/**
 * O subtotal como a tabela densa o consome: um mapa de coluna para valor.
 *
 * As colunas de retorno não aparecem aqui de propósito. Somar variação de
 * linhas só valeria sem aporte nem resgate no período, e a `api` não manda o
 * número justamente por isso — a tabela mostra traço, que é o que não há.
 */
export const toSummary = (summary: PositionSummary): GroupSummary => ({
  valor: summary.value,
  custo: summary.cost_basis,
  resultado: summary.open_result,
  resultado_pct: summary.open_result_ratio,
  peso: summary.weight,
  contagem: String(summary.count),
});

export const toTableGroups = (
  groups: readonly PositionGroup[],
): readonly TableGroup<PositionResource>[] =>
  groups.map((group) => ({
    key: group.key,
    label: group.label,
    colorToken: group.color_token ?? undefined,
    rows: group.positions,
    summary: toSummary(group.summary),
  }));

/**
 * A linha de números abaixo do título: quantas posições, quanto somam, o
 * resultado aberto e os proventos de doze meses.
 */
export const positionsCountLabel = (total: PositionSummary): string =>
  total.count === 1 ? '1 posição' : `${total.count} posições`;

/**
 * A ressalva de procedência, no rodapé da tabela. Sem fechamento ainda não há
 * o que ressalvar — e é a tela vazia que responde, não esta linha.
 */
export const priceStamp = (resource: PositionsResource): string | null => {
  if (resource.as_of === null) return null;

  const stamp = resource.computed_at === null ? null : new Date(resource.computed_at);
  const time =
    stamp === null || Number.isNaN(stamp.getTime())
      ? null
      : `${String(stamp.getHours()).padStart(2, '0')}:${String(
          stamp.getMinutes(),
        ).padStart(2, '0')}`;

  const day = formatShortDate(resource.as_of);
  return time === null
    ? `Posições de ${day}.`
    : `Posições de ${day}, apuradas às ${time}.`;
};

/**
 * O que alguém digita num campo de valor, em decimal do contrato.
 *
 * `1.360,57` e `1360.57` são a mesma coisa para quem digita e coisas
 * diferentes para o Postgres. A conversão é de texto para texto, sem passar
 * por `number`: é dinheiro, e a regra vale até no campo de formulário.
 */
export const parseAmountInput = (typed: string): string | null => {
  const trimmed = typed.trim();
  if (trimmed === '') return null;

  // Vírgula decimal: o ponto que sobrou é separador de milhar.
  const normalized = trimmed.includes(',')
    ? trimmed.replaceAll('.', '').replace(',', '.')
    : trimmed;

  return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : null;
};

/** O valor que o campo mostra ao abrir: o preço de hoje, em pt-BR. */
export const amountInputValue = (value: string | null, decimals = 2): string =>
  value === null ? '' : formatQuantity(value, { decimals }).text;
