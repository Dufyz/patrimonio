/** Texto sem acento e em minúsculas, para a busca ignorar `Saúde` × `saude`. */
export const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/**
 * A busca filtra enquanto digita: todas as palavras da consulta precisam
 * aparecer em algum dos campos. Consulta vazia casa com tudo.
 */
export const matchesSearch = (query: string, fields: readonly string[]): boolean => {
  const words = normalizeText(query)
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return true;
  const haystack = normalizeText(fields.join(' '));
  return words.every((word) => haystack.includes(word));
};
