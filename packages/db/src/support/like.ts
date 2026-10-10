/**
 * `%` e `_` digitados pela pessoa são texto, não curinga: buscar "50%" não pode
 * casar com tudo, e buscar "A_B" não pode casar com "AxB".
 */
const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`);

/** O texto em qualquer posição. */
export const likeContains = (term: string): string => `%${escapeLike(term)}%`;

/** O texto no começo. */
export const likePrefix = (term: string): string => `${escapeLike(term)}%`;
