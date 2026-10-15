import type {
  ClosedPosition,
  PositionGroup,
  PositionResource,
  PositionSummary,
  PositionsResource,
} from '@patrimonio/contracts';
import type { DateOnly, PositionGroupBy } from '@patrimonio/domain';

import { isZero, parseDecimal } from './decimal.js';
import { formatPercent, formatQuantity } from './format.js';
import type { GroupSummary, TableGroup } from './table/model.js';
import { decimalComma, quoted, safeText } from './statement.js';

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
  classe: 'class',
  categoria: 'category',
  instituicao: 'institution',
  carteira: 'portfolio',
  nenhum: 'none',
} as const satisfies Readonly<Record<string, PositionGroupBy>>;

export type GroupByParam = keyof typeof GROUP_BY_PARAM;

export const GROUP_BY_PARAMS = Object.keys(GROUP_BY_PARAM) as readonly GroupByParam[];

export const DEFAULT_GROUP_BY: GroupByParam = 'classe';

export const toGroupBy = (param: GroupByParam): PositionGroupBy => GROUP_BY_PARAM[param];

export type GroupByOption = {
  readonly value: GroupByParam;
  readonly label: string;
};

/**
 * As opções do seletor de agrupamento. "Carteira" só aparece no escopo de todas
 * elas: dentro de uma carteira, agrupar por carteira devolve um grupo só, e uma
 * opção que não faz nada é pior que uma opção a menos.
 */
export const groupByOptions = (allPortfolios: boolean): readonly GroupByOption[] => [
  { value: 'classe', label: 'Classe' },
  { value: 'categoria', label: 'Categoria' },
  { value: 'instituicao', label: 'Instituição' },
  ...(allPortfolios ? ([{ value: 'carteira', label: 'Carteira' }] as const) : []),
  { value: 'nenhum', label: 'Sem grupo' },
];

/** O agrupamento que vale, dado o escopo: por carteira só com todas elas. */
export const effectiveGroupBy = (
  param: GroupByParam,
  allPortfolios: boolean,
): GroupByParam => (param === 'carteira' && !allPortfolios ? DEFAULT_GROUP_BY : param);

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

/** A linha da tabela: posição aberta, ou encerrada quando `closed` (desabilitada). */
export type PositionRow = PositionResource & { readonly closed?: boolean };

/**
 * Uma posição encerrada como linha da tabela. Não tem quantidade, preço nem
 * valor — o que há é histórico —, e `closed` é o que a tabela usa para
 * esmaecê-la, desabilitá-la e deixá-la no fim do grupo.
 */
export const closedAsRow = (
  closed: ClosedPosition,
  portfolioId: string | null,
): PositionRow => ({
  // Em Todas as carteiras a encerrada soma carteiras e não tem uma: vazio.
  portfolio_id: portfolioId ?? '',
  portfolio_name: '',
  asset_id: closed.asset_id,
  ticker: closed.ticker,
  name: closed.name,
  origin: 'market',
  b3_type: null,
  institution_id: null,
  institution_name: null,
  category_id: null,
  category_name: closed.category_name,
  class_name: closed.class_name,
  color_token: closed.color_token,
  unit: 'quantity',
  quantity: null,
  avg_price: null,
  price: null,
  price_health: 'missing',
  price_date: null,
  // Na encerrada, "investido" é o que entrou, "atualizado" é o que saiu nas
  // vendas, e o resultado inclui os proventos recebidos.
  value: closed.proceeds,
  cost_basis: closed.invested,
  open_result: closed.total_result,
  open_result_ratio: closed.total_result_ratio,
  weight: '0',
  day_change_ratio: null,
  return_12m_ratio: null,
  dividend_yield_12m: null,
  indexer: null,
  rate: null,
  maturity_date: null,
  closed: true,
});

const NO_CATEGORY_LABEL = 'Sem categoria';

/**
 * Junta as encerradas aos grupos. Por categoria, cada uma vai para o grupo da
 * sua categoria (criado ao fim se só tem encerradas); nos outros agrupamentos,
 * vão para o fim do grupo único ou para um grupo "Encerradas". Os subtotais
 * continuam os da `api`: encerrada não soma.
 */
export const withClosedRows = (
  groups: readonly TableGroup<PositionRow>[],
  closed: readonly PositionRow[],
  groupBy: PositionGroupBy,
): readonly TableGroup<PositionRow>[] => {
  if (closed.length === 0) return groups;

  const next = groups.map((group) => ({ ...group, rows: [...group.rows] }));
  const empty: GroupSummary = {
    valor: '0',
    custo: '0',
    resultado: '0',
    peso: '0',
    contagem: '0',
  };

  const place = (row: PositionRow, key: string, label: string): void => {
    const found = next.find((group) => group.key === key);
    if (found !== undefined) {
      found.rows.push(row);
      return;
    }
    next.push({
      key,
      label,
      colorToken: row.color_token ?? undefined,
      rows: [row],
      summary: empty,
    });
  };

  for (const row of closed) {
    if (groupBy === 'class' || groupBy === 'category') {
      const label =
        (groupBy === 'class' ? row.class_name : row.category_name) ?? NO_CATEGORY_LABEL;
      const match = next.find((group) => group.label === label);
      place(row, match?.key ?? `encerradas:${label}`, label);
    } else if (groupBy === 'none' && next.length === 1) {
      next[0]?.rows.push(row);
    } else {
      place(row, 'encerradas', 'Encerradas');
    }
  }

  return next;
};

export const toTableGroups = (
  groups: readonly PositionGroup[],
): readonly TableGroup<PositionRow>[] =>
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

  const hhmm = (iso: string): string | null => {
    const at = new Date(iso);
    return Number.isNaN(at.getTime())
      ? null
      : `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  };

  if (resource.live !== null && resource.live.applied > 0) {
    const live = resource.live;
    const at = hhmm(live.as_of);
    const rest = live.requested - live.applied;
    return `Cotações ao vivo${at === null ? '' : ` às ${at}`} em ${live.applied} de ${live.requested} papéis${
      rest > 0
        ? ` — os demais seguem a preço de fechamento de ${formatShortDate(resource.as_of)}`
        : ''
    }. Renda fixa segue na curva.`;
  }

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

  // Vírgula decimal: o ponto que sobrou é separador de milhar. Sem vírgula,
  // pontos em grupos de exatos três dígitos (`1.234`, como a máscara de dinheiro
  // escreve) também são milhar; `36.84` continua sendo decimal.
  const normalized = trimmed.includes(',')
    ? trimmed.replaceAll('.', '').replace(',', '.')
    : /^-?\d{1,3}(\.\d{3})+$/.test(trimmed)
      ? trimmed.replaceAll('.', '')
      : trimmed;

  return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : null;
};

/** O valor que o campo mostra ao abrir: o preço de hoje, em pt-BR. */
export const amountInputValue = (value: string | null, decimals = 2): string =>
  value === null ? '' : formatQuantity(value, { decimals }).text;

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */

const POSITIONS_CSV_HEADER = [
  'Grupo',
  'Ativo',
  'Instituição',
  'Quantidade',
  'Preço médio',
  'Preço',
  'Valor',
  'Peso',
  'Resultado',
  'Resultado %',
] as const;

/**
 * O CSV das posições que estão na tela: `;` e vírgula decimal, como o do
 * extrato, com os valores exatamente como a `api` os mandou.
 */
export const positionsCsv = (groups: readonly PositionGroup[]): string => {
  const lines = groups.flatMap((group) =>
    group.positions.map((position) =>
      [
        safeText(group.label),
        safeText(positionTitle(position)),
        safeText(position.institution_name ?? ''),
        decimalComma(position.quantity ?? ''),
        decimalComma(position.avg_price ?? ''),
        decimalComma(position.price ?? ''),
        decimalComma(position.value),
        decimalComma(position.weight),
        decimalComma(position.open_result),
        decimalComma(position.open_result_ratio ?? ''),
      ]
        .map(quoted)
        .join(';'),
    ),
  );

  return [POSITIONS_CSV_HEADER.map(quoted).join(';'), ...lines].join('\r\n');
};

export const positionsCsvFilename = (day: string): string => `posicoes-${day}.csv`;
