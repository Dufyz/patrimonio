import { FormatChangedError } from '@patrimonio/application';
import type { DateOnly } from '@patrimonio/domain';
import { isDateOnly } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { excerpt } from '../http/client.js';

/**
 * Os guardas de leitura de resposta externa. A regra que eles existem para
 * impor: **nenhum valor é gravado quando o formato não é reconhecido.**
 *
 * Um campo que virou `undefined` silencioso não dá erro — dá número errado, e
 * número errado no patrimônio só aparece meses depois, sem rastro de onde veio.
 * Então cada leitura é explícita e cada falha nomeia o campo.
 *
 * Internamente os guardas lançam; o provedor captura na borda e devolve
 * `failure(FormatChangedError)`. É o mesmo arranjo de `getRepositoryError` em
 * `db`: exceção não atravessa camada, mas dentro de um parser ela economiza
 * trinta ramos de `Either` que nunca seriam lidos.
 */
class FormatChanged extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
    readonly received: unknown,
  ) {
    super(`${field} ${reason}`);
    this.name = 'FormatChanged';
  }
}

const show = (value: unknown): string => {
  if (value === undefined) return 'ausente';
  if (typeof value === 'string') return excerpt(JSON.stringify(value));

  try {
    return excerpt(JSON.stringify(value) ?? String(value));
  } catch {
    return excerpt(String(value));
  }
};

const fail = (field: string, reason: string, received: unknown): never => {
  throw new FormatChanged(field, reason, received);
};

/**
 * A mudança de formato declarada na mão, para o que não é leitura de campo:
 * coluna que saiu de um CSV, registro de largura fixa mais curto do que o
 * layout, envelope que mudou de nome.
 */
export const formatChanged = (
  field: string,
  reason: string,
  received: unknown,
): never => fail(field, reason, received);

/** O corpo da resposta como objeto. Corpo vazio é mudança de formato. */
export const asObject = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(field, 'não é um objeto', value);
  }

  return value as Record<string, unknown>;
};

export const asArray = (value: unknown, field: string): readonly unknown[] => {
  if (!Array.isArray(value)) return fail(field, 'não é uma lista', value);

  return value;
};

/** JSON que não parseia é mudança de formato, não erro de rede. */
export const asJson = (body: string, field = 'body'): unknown => {
  if (body.trim() === '') return fail(field, 'veio vazio', body);

  try {
    return JSON.parse(body);
  } catch {
    return fail(field, 'não é JSON válido', body);
  }
};

/** Desce no envelope. Envelope alterado falha aqui, nomeando o caminho. */
export const at = (
  source: Record<string, unknown>,
  path: readonly string[],
): unknown => {
  let current: unknown = source;

  for (const [index, key] of path.entries()) {
    const here = asObject(current, path.slice(0, index).join('.') || 'body');
    if (!(key in here)) {
      return fail(path.slice(0, index + 1).join('.'), 'não está na resposta', here);
    }

    current = here[key];
  }

  return current;
};

/**
 * Em todo guarda, `path` é como o campo aparece no erro. O padrão é o próprio
 * nome, e quem lê uma lista passa o caminho inteiro — `resultados[3].preco` diz
 * onde olhar; `preco` sozinho, numa resposta com trinta papéis, não diz.
 */
export const stringField = (
  source: Record<string, unknown>,
  field: string,
  path = field,
): string => {
  const value = source[field];

  if (typeof value !== 'string') return fail(path, 'não é texto', value);
  if (value.trim() === '') return fail(path, 'veio vazio', value);

  return value;
};

/**
 * Um decimal como a fonte publicou. Aceita ponto e vírgula como separador, e
 * aceita número — algumas fontes mudaram de string para number sem avisar, e
 * isso **não** é motivo para derrubar a coleta, porque o valor é o mesmo.
 *
 * O que não é aceito: texto que não é número, vazio, nulo, `NaN`, infinito e
 * notação com separador de milhar ambíguo. Um deles passando viraria preço.
 */
export const decimalField = (
  source: Record<string, unknown>,
  field: string,
  path = field,
): string => {
  const value = source[field];

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail(path, 'não é um número finito', value);

    return String(value);
  }

  if (typeof value !== 'string') return fail(path, 'não é um número', value);

  const trimmed = value.trim();
  if (trimmed === '') return fail(path, 'veio vazio', value);

  // Vírgula por ponto é a troca mais comum numa fonte brasileira, e ela é
  // aceita — mas só quando não há ambiguidade com separador de milhar.
  const normalized =
    trimmed.includes(',') && !trimmed.includes('.')
      ? trimmed.replace(',', '.')
      : trimmed.includes(',') && trimmed.includes('.')
        ? trimmed.replace(/\./gu, '').replace(',', '.')
        : trimmed;

  if (!/^-?\d+(\.\d+)?$/u.test(normalized)) {
    return fail(path, 'não é um número reconhecível', value);
  }

  return normalized;
};

/**
 * Uma data, em `YYYY-MM-DD` ou `DD/MM/YYYY`. Outro formato falha: uma data lida
 * errada desloca o preço de um dia, e um dia deslocado no fechamento é um buraco
 * na série que ninguém procura.
 */
export const dateField = (
  source: Record<string, unknown>,
  field: string,
  path = field,
): DateOnly => {
  const value = source[field];

  if (typeof value !== 'string') return fail(path, 'não é uma data', value);

  const trimmed = value.trim().slice(0, 10);

  if (isDateOnly(trimmed)) return trimmed;

  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(trimmed);
  if (brazilian !== null) {
    const candidate = `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;
    if (isDateOnly(candidate)) return candidate;
  }

  return fail(path, 'não está num formato de data reconhecido', value);
};

/** O campo quando ele existe, sem falhar quando não existe. */
export const optionalDateField = (
  source: Record<string, unknown>,
  field: string,
  path = field,
): DateOnly | null =>
  source[field] === undefined || source[field] === null
    ? null
    : dateField(source, field, path);

/**
 * A borda. Tudo o que um provedor faz ao ler resposta externa passa por aqui: o
 * guarda que lançou volta como `FormatChangedError` com campo e trecho, e
 * qualquer outra exceção também — um `TypeError` inesperado na leitura também é
 * a resposta não tendo a forma esperada.
 */
export const parsing = <T>(
  source: string,
  read: () => T,
): Either<FormatChangedError, T> => {
  try {
    return success(read());
  } catch (error) {
    if (error instanceof FormatChanged) {
      return failure(
        new FormatChangedError(source, error.field, error.reason, show(error.received)),
      );
    }

    return failure(
      new FormatChangedError(
        source,
        '(resposta)',
        `não pôde ser lida: ${error instanceof Error ? error.message : String(error)}`,
        '',
      ),
    );
  }
};

export { FormatChanged };
