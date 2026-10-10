import type { DateOnly } from '../support/date_only.js';

/**
 * Uma só tabela para ativo listado e título cadastrado à mão. A diferença está
 * em `origin` e nas colunas de renda fixa, nulas no ativo listado.
 *
 * Tesouro Direto é `market` **com** vencimento e indexador: ter preço de mercado
 * e ter vencimento são coisas independentes, e o modelo não as amarra.
 */
export const ASSET_ORIGINS = ['market', 'manual'] as const;
export const PRICE_SOURCES = ['auto', 'manual'] as const;
export const INDEXERS = ['cdi_pct', 'ipca_plus', 'prefixed', 'selic_plus'] as const;
export const LIQUIDITY_KINDS = ['daily', 'at_maturity', 'd_plus_n'] as const;
export const TAX_REGIMES = ['regressive', 'exempt'] as const;

/**
 * O tipo do papel na B3. Não é derivável do ticker — `TAEE11` é unit e `KNRI11`
 * é FII, e os dois terminam em 11 — então ele é guardado, e é o que a regra
 * automática de categoria olha.
 */
export const B3_TYPES = ['stock', 'fii', 'etf', 'bdr', 'treasury', 'cash'] as const;

export type AssetOrigin = (typeof ASSET_ORIGINS)[number];
export type PriceSource = (typeof PRICE_SOURCES)[number];
export type Indexer = (typeof INDEXERS)[number];
export type LiquidityKind = (typeof LIQUIDITY_KINDS)[number];
export type TaxRegime = (typeof TAX_REGIMES)[number];
export type B3Type = (typeof B3_TYPES)[number];

export const isIndexer = (value: unknown): value is Indexer =>
  typeof value === 'string' && (INDEXERS as readonly string[]).includes(value);

export const isB3Type = (value: unknown): value is B3Type =>
  typeof value === 'string' && (B3_TYPES as readonly string[]).includes(value);

export type Asset = {
  readonly id: string;
  readonly ticker: string;
  readonly name: string;
  readonly origin: AssetOrigin;
  readonly b3_type: B3Type | null;
  readonly category_id: string | null;
  readonly sector: string | null;
  readonly price_source: PriceSource;
  /** Emissor do título. Obrigatório quando `origin` é `manual`. */
  readonly issuer_id: string | null;
  readonly indexer: Indexer | null;
  /** O significado depende do indexador: 112 em `cdi_pct` é 112% do CDI. */
  readonly rate: string | null;
  readonly issued_at: DateOnly | null;
  readonly maturity_date: DateOnly | null;
  readonly liquidity: LiquidityKind | null;
  readonly liquidity_days: number | null;
  readonly tax_regime: TaxRegime | null;
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

/**
 * O nome exibido de um título bancário é gerado e editável: "CDB Banco C
 * 10/2028 · 112% CDI" diz mais na tabela do que o código interno, e ninguém
 * quer digitar isso a cada aplicação.
 */
export const describeFixedIncome = (input: {
  readonly kind: string;
  readonly issuer_name: string;
  readonly maturity_date: DateOnly | null;
  readonly indexer: Indexer | null;
  readonly rate: string | null;
}): string => {
  const parts = [input.kind.toUpperCase(), input.issuer_name];

  if (input.maturity_date !== null) {
    const [year, month] = input.maturity_date.split('-');
    if (year !== undefined && month !== undefined) parts.push(`${month}/${year}`);
  }

  const rate = input.rate;
  if (rate !== null && input.indexer !== null) {
    const number = Number(rate);
    const formatted = Number.isInteger(number) ? String(number) : String(number);

    switch (input.indexer) {
      case 'cdi_pct':
        parts.push(`${formatted}% CDI`);
        break;
      case 'ipca_plus':
        parts.push(`IPCA + ${formatted}%`);
        break;
      case 'selic_plus':
        parts.push(`Selic + ${formatted}%`);
        break;
      case 'prefixed':
        parts.push(`${formatted}% a.a.`);
        break;
    }
  }

  return parts.join(' · ');
};

/** O código interno de um título sem ticker público, estável e legível. */
export const fixedIncomeTicker = (input: {
  readonly kind: string;
  readonly issuer_name: string;
  readonly maturity_date: DateOnly | null;
  readonly suffix?: string | undefined;
}): string => {
  const issuer = input.issuer_name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 8);

  const maturity =
    input.maturity_date === null ? '' : input.maturity_date.replace(/-/g, '');
  const suffix = input.suffix === undefined ? '' : `-${input.suffix}`;

  return `${input.kind.toUpperCase()}-${issuer}-${maturity}${suffix}`;
};

/**
 * O caixa é um ativo sintético por instituição: assim o aporte é um lançamento
 * como os outros, e o dinheiro parado aparece em Posições e na alocação em vez
 * de virar uma coluna de saldo que nenhuma tela soma.
 *
 * A posição de um ativo de caixa não é a soma das quantidades lançadas nele: é
 * a soma dos valores líquidos da carteira naquela instituição — comprar tira,
 * vender e receber provento põem. Quem responde por isso é `cashBalance`, em
 * `packages/calc`.
 */
export const cashAssetTicker = (institutionName: string): string => {
  const slug = institutionName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 12);

  return `CAIXA-${slug}`;
};

export const cashAssetName = (institutionName: string): string =>
  `Caixa · ${institutionName}`;
