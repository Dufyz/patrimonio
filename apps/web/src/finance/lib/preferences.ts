import { readEnum, writeRaw } from '../../lib/preferences.js';
import type { Storageish } from '../../lib/preferences.js';

/**
 * FIN-007 · O que persiste por dispositivo.
 *
 * Persistem: tema, barra lateral recolhida, ocultar valores, colunas visíveis
 * por tela (`lib/columns.ts`) e o último agrupamento de Lançamentos. Período e
 * filtros **não** persistem: ao abrir, o período é o mês corrente e os filtros
 * estão limpos. Se o armazenamento do navegador estiver indisponível, o app
 * funciona com os padrões — toda leitura aqui é defensiva.
 */

export const ENTRY_GROUPINGS = ['dia', 'tipo', 'categoria', 'conta'] as const;
export type EntryGrouping = (typeof ENTRY_GROUPINGS)[number];

export const DEFAULT_GROUPING: EntryGrouping = 'dia';

export const GROUPING_KEY = 'patrimonio.finance.entries-grouping';

export const readEntryGrouping = (storage: Storageish | null): EntryGrouping =>
  readEnum(storage, GROUPING_KEY, ENTRY_GROUPINGS, DEFAULT_GROUPING);

export const writeEntryGrouping = (
  storage: Storageish | null,
  grouping: EntryGrouping,
): void => writeRaw(storage, GROUPING_KEY, grouping);
