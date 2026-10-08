import type { Storageish } from './preferences.js';
import { readBoolean, writeRaw } from './preferences.js';

/**
 * D-03 · Modo de valores ocultos.
 *
 * O objetivo é abrir a aplicação em lugar público sem perder a leitura: some o
 * valor em reais, fica o percentual, a alocação e a forma das barras. Por isso
 * o modo não é "borrar a tela" — é trocar o conteúdo de um tipo de número só.
 *
 * O estado persiste entre sessões porque quem usa em lugar público costuma usar
 * de novo no mesmo lugar, e ter que apertar o atalho toda vez acaba com o hábito.
 */

export const HIDDEN_VALUES_KEY = 'patrimonio.hidden_values';

/** Tecla que alterna o modo, como a tela de Configurações anuncia. */
export const HIDDEN_VALUES_SHORTCUT = 'h';

export const readHiddenValues = (storage: Storageish | null): boolean =>
  readBoolean(storage, HIDDEN_VALUES_KEY, false);

export const writeHiddenValues = (storage: Storageish | null, hidden: boolean): void =>
  writeRaw(storage, HIDDEN_VALUES_KEY, hidden ? 'true' : 'false');
