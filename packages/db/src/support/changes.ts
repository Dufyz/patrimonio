/**
 * `undefined` significa "não mexa nesta coluna" e `null` significa "apague o
 * valor". O driver recusa `undefined` como parâmetro, e é bom que recuse: a
 * alternativa seria gravar nulo onde o usuário não pediu nada.
 */
export type Changes = Record<string, unknown>;

export const definedColumns = (value: Changes): Changes =>
  Object.fromEntries(Object.entries(value).filter(([, column]) => column !== undefined));

export const hasChanges = (value: Changes): boolean => Object.keys(value).length > 0;
