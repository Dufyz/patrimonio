import type { DateOnly } from '../support/date_only.js';

export const TREASURY_KINDS = ['ipca_plus', 'prefixed', 'selic_plus'] as const;

export type TreasuryKind = (typeof TREASURY_KINDS)[number];

export type TreasuryIdentity = {
  readonly kind: TreasuryKind;
  readonly coupon: boolean;
  readonly maturity_date: DateOnly;
};

const CODE_BY_KIND: Readonly<Record<TreasuryKind, string>> = {
  ipca_plus: 'IPCA',
  prefixed: 'PRE',
  selic_plus: 'SELIC',
};

const LABEL_BY_KIND: Readonly<Record<TreasuryKind, string>> = {
  ipca_plus: 'IPCA+',
  prefixed: 'Prefixado',
  selic_plus: 'Selic',
};

const COUPON_CODE = 'JS';

const TICKER_PATTERN = /^TD-(IPCA|PRE|SELIC)(JS)?-(\d{4})(\d{2})(\d{2})$/u;

/**
 * O código do título do Tesouro, derivado do indexador, de ter ou não juros
 * semestrais e do vencimento. Não depende do nome comercial, que já mudou, e é o
 * mesmo em toda carga.
 */
export const treasuryTicker = (identity: TreasuryIdentity): string =>
  `TD-${CODE_BY_KIND[identity.kind]}${identity.coupon ? COUPON_CODE : ''}-${identity.maturity_date.replace(/-/gu, '')}`;

export const treasuryName = (identity: TreasuryIdentity): string =>
  `Tesouro ${LABEL_BY_KIND[identity.kind]}${identity.coupon ? ' com Juros Semestrais' : ''} ${identity.maturity_date.slice(0, 4)}`;

export const parseTreasuryTicker = (ticker: string): TreasuryIdentity | null => {
  const match = TICKER_PATTERN.exec(ticker.toUpperCase());
  if (match === null) return null;

  const [, code, coupon, year, month, day] = match;
  const kind = TREASURY_KINDS.find((candidate) => CODE_BY_KIND[candidate] === code);
  if (kind === undefined) return null;

  return {
    kind,
    coupon: coupon === COUPON_CODE,
    maturity_date: `${year}-${month}-${day}` as DateOnly,
  };
};
