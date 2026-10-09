import { Decimal } from 'decimal.js';

import type { BenchmarkDefinition, BenchmarkPart } from './benchmark.js';

/**
 * A definição de um benchmark como o banco a guarda → a definição que o motor
 * calcula.
 *
 * O modelo de dados escreve o cupom em **fração anual** (`{"index":"IPCA",
 * "rate":0.06}` é IPCA + 6%), e o motor recebe **percentual** (`'6'`), porque é
 * assim que `dailySpread` compõe. A conversão mora aqui, num lugar só: quem
 * escreve benchmark (Configurações) e quem lê (Desempenho) concordam no que o
 * banco guarda, e o motor não precisa saber de onde o número veio.
 *
 * Definição que não faz sentido devolve `null` em vez de um benchmark parado em
 * 1: uma linha de benchmark plana no gráfico parece "o CDI não rendeu nada", e
 * é a mentira plausível que esta tela existe para não contar.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const asNumeric = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return value.trim();
  }
  return null;
};

export const parseBenchmarkDefinition = (
  kind: string,
  definition: unknown,
): BenchmarkDefinition | null => {
  if (!isRecord(definition)) return null;

  if (kind === 'index') {
    const index = asText(definition['index']);
    return index === null ? null : { kind: 'index', index };
  }

  if (kind === 'index_plus_rate') {
    const index = asText(definition['index']);
    const fraction = asNumeric(definition['rate']);
    if (index === null || fraction === null) return null;

    return {
      kind: 'index_plus_rate',
      index,
      rate: new Decimal(fraction).times(100).toString(),
    };
  }

  if (kind === 'blend') {
    const raw = definition['parts'];
    if (!Array.isArray(raw) || raw.length === 0) return null;

    const parts: BenchmarkPart[] = [];

    for (const item of raw as unknown[]) {
      if (!isRecord(item)) return null;

      const index = asText(item['index']);
      const weight = asNumeric(item['weight']);
      if (index === null || weight === null || new Decimal(weight).isNegative()) {
        return null;
      }

      parts.push({ index, weight });
    }

    return { kind: 'blend', parts };
  }

  return null;
};

/** Os índices de que a definição depende: o que `index_quote` precisa entregar. */
export const indexCodesOf = (definition: BenchmarkDefinition): readonly string[] =>
  definition.kind === 'blend'
    ? [...new Set(definition.parts.map((part) => part.index))]
    : [definition.index];
