import { INDEX_CODES } from '../projection/projection.entities.js';
import type { IndexCode } from '../projection/projection.entities.js';

/**
 * O benchmark de uma carteira é um valor, e não um cadastro: o índice sozinho
 * (`CDI`), o índice mais uma taxa anual (`IPCA+6`) ou um percentual do índice
 * (`110%CDI`). O texto canônico é o que se guarda na carteira e o que a URL de
 * Desempenho carrega; quem digita pode escrever `IPCA + 6%` ou `110% do CDI`,
 * e `parseBenchmark` devolve a mesma coisa.
 */
export type BenchmarkValue =
  | { readonly kind: 'index'; readonly index: IndexCode }
  | {
      readonly kind: 'index_plus_rate';
      readonly index: IndexCode;
      /** Percentual ao ano: `6` é IPCA + 6%. */
      readonly rate: string;
    }
  | {
      readonly kind: 'percent_of_index';
      readonly index: IndexCode;
      /** `110` é 110% do índice. */
      readonly percent: string;
    };

export const INDEX_LABELS: Readonly<Record<IndexCode, string>> = {
  CDI: 'CDI',
  SELIC: 'Selic',
  IPCA: 'IPCA',
  IBOV: 'Ibovespa',
  IFIX: 'IFIX',
};

const NUMBER = '(\\d+(?:\\.\\d+)?)';
const INDEX_PLUS_RATE = new RegExp(`^([A-Z]+)\\+${NUMBER}%?$`);
const PERCENT_OF_INDEX = new RegExp(`^${NUMBER}%(?:DO|DA|DE)?([A-Z]+)$`);
const PLAIN_INDEX = /^[A-Z]+$/;

const asIndex = (code: string | undefined): IndexCode | null =>
  code !== undefined && (INDEX_CODES as readonly string[]).includes(code)
    ? (code as IndexCode)
    : null;

/** Sem zeros à direita: `6.50` e `6.5` são o mesmo benchmark. */
const trimNumber = (text: string): string =>
  text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;

const isPositive = (text: string): boolean => Number(text) > 0;

/**
 * Lê o que a pessoa digitou. Maiúsculas, espaços e vírgula decimal não importam;
 * índice desconhecido, taxa zero e texto solto devolvem `null` em vez de um
 * benchmark parado em zero.
 */
export const parseBenchmark = (text: string): BenchmarkValue | null => {
  const normalized = text.toUpperCase().replace(/\s+/g, '').replace(/,/g, '.');

  const plus = INDEX_PLUS_RATE.exec(normalized);
  if (plus !== null) {
    const index = asIndex(plus[1]);
    const rate = plus[2];
    if (index === null || rate === undefined || !isPositive(rate)) return null;

    return { kind: 'index_plus_rate', index, rate: trimNumber(rate) };
  }

  const percent = PERCENT_OF_INDEX.exec(normalized);
  if (percent !== null) {
    const index = asIndex(percent[2]);
    const value = percent[1];
    if (index === null || value === undefined || !isPositive(value)) return null;

    return { kind: 'percent_of_index', index, percent: trimNumber(value) };
  }

  if (PLAIN_INDEX.test(normalized)) {
    const index = asIndex(normalized);
    return index === null ? null : { kind: 'index', index };
  }

  return null;
};

/** O texto canônico: `CDI`, `IPCA+6`, `110%CDI`. */
export const formatBenchmark = (value: BenchmarkValue): string => {
  switch (value.kind) {
    case 'index':
      return value.index;
    case 'index_plus_rate':
      return `${value.index}+${value.rate}`;
    case 'percent_of_index':
      return `${value.percent}%${value.index}`;
  }
};

/** O nome na tela: `CDI`, `IPCA + 6%`, `110% do CDI`. */
export const benchmarkLabel = (value: BenchmarkValue): string => {
  const name = INDEX_LABELS[value.index];

  switch (value.kind) {
    case 'index':
      return name;
    case 'index_plus_rate':
      return `${name} + ${value.rate}%`;
    case 'percent_of_index':
      return `${value.percent}% do ${name}`;
  }
};

/** O texto canônico de um texto digitado, ou `null` se ele não é um benchmark. */
export const normalizeBenchmark = (text: string): string | null => {
  const parsed = parseBenchmark(text);
  return parsed === null ? null : formatBenchmark(parsed);
};

/** O valor canônico e o nome na tela de um benchmark guardado; `null` para texto que não é benchmark. */
export const describeBenchmark = (
  text: string | null,
): { readonly value: string; readonly name: string } | null => {
  if (text === null) return null;

  const parsed = parseBenchmark(text);
  return parsed === null
    ? null
    : { value: formatBenchmark(parsed), name: benchmarkLabel(parsed) };
};
