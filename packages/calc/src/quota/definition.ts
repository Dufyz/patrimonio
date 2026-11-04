import type { BenchmarkDefinition } from './benchmark.js';

/** Os índices de que a definição depende: o que `index_quote` precisa entregar. */
export const indexCodesOf = (definition: BenchmarkDefinition): readonly string[] => [
  definition.index,
];
