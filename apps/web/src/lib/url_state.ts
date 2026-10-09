import type { Period } from './period.js';
import { DEFAULT_PERIOD, decodePeriod, encodePeriod } from './period.js';

/**
 * D-06 · O estado dos controles na URL.
 *
 * Período, filtros, agrupamento e benchmarks vão para a query, e não para o
 * estado do componente, por três razões que aparecem no uso diário: voltar e
 * avançar funcionam, a tela pode ser aberta em outra aba com o mesmo recorte, e
 * recarregar não perde o filtro.
 *
 * O valor padrão nunca é escrito. Uma URL de Posições sem nenhum filtro é
 * `/posicoes`, não `/posicoes?periodo=12m&agrupar=categoria&classe=`, e isso é
 * o que torna a URL compartilhável sem parecer um despejo de estado.
 */

export type ParamCodec<T> = {
  readonly key: string;
  readonly decode: (raw: string | null) => T;
  /** `null` apaga o parâmetro — é como o padrão some da URL. */
  readonly encode: (value: T) => string | null;
  readonly equals: (left: T, right: T) => boolean;
};

export const textParam = (key: string): ParamCodec<string> => ({
  key,
  decode: (raw) => raw ?? '',
  encode: (value) => (value.trim() === '' ? null : value),
  equals: (left, right) => left === right,
});

export const enumParam = <T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): ParamCodec<T> => ({
  key,
  decode: (raw) =>
    raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback,
  encode: (value) => (value === fallback ? null : value),
  equals: (left, right) => left === right,
});

/**
 * Lista separada por vírgula. A ordem não importa para o significado, então a
 * codificação ordena: duas telas com os mesmos filtros têm a mesma URL, e a
 * memória do navegador não guarda duas entradas para o mesmo recorte.
 */
export const listParam = (key: string): ParamCodec<readonly string[]> => ({
  key,
  decode: (raw) =>
    raw === null || raw === ''
      ? []
      : [...new Set(raw.split(',').filter((item) => item !== ''))].toSorted(),
  encode: (value) =>
    value.length === 0 ? null : [...new Set(value)].toSorted().join(','),
  equals: (left, right) =>
    left.length === right.length && left.every((item, index) => item === right[index]),
});

export const periodParam = (key = 'periodo'): ParamCodec<Period> => ({
  key,
  decode: decodePeriod,
  encode: (value) => (value === DEFAULT_PERIOD ? null : encodePeriod(value)),
  equals: (left, right) => encodePeriod(left) === encodePeriod(right),
});

export type CodecMap<S> = { readonly [K in keyof S]: ParamCodec<S[K]> };

export const readParams = <S>(search: URLSearchParams, codecs: CodecMap<S>): S => {
  const out = {} as Record<keyof S, unknown>;
  for (const name of Object.keys(codecs) as (keyof S)[]) {
    out[name] = codecs[name].decode(search.get(codecs[name].key));
  }
  return out as S;
};

/**
 * Aplica mudanças preservando o que a URL já tinha e que não é dos controles —
 * uma âncora, um parâmetro de outra parte da tela. Sobrescrever a query inteira
 * é o jeito fácil e é o que faz um filtro apagar o estado de um painel vizinho.
 */
export const writeParams = <S>(
  search: URLSearchParams,
  codecs: CodecMap<S>,
  changes: Partial<S>,
): URLSearchParams => {
  const next = new URLSearchParams(search);

  for (const name of Object.keys(changes) as (keyof S)[]) {
    const value = changes[name];
    if (value === undefined) continue;

    const encoded = codecs[name].encode(value);
    if (encoded === null) next.delete(codecs[name].key);
    else next.set(codecs[name].key, encoded);
  }

  return next;
};

/** Volta tudo ao padrão: é a ação "limpar tudo" da barra de filtros. */
export const clearParams = <S>(
  search: URLSearchParams,
  codecs: CodecMap<S>,
): URLSearchParams => {
  const next = new URLSearchParams(search);
  for (const name of Object.keys(codecs) as (keyof S)[]) next.delete(codecs[name].key);
  return next;
};
