import { request } from './client.js';

/**
 * Exportar tudo e apagar tudo.
 *
 * A exportação lê a resposta como **texto**: o documento sai do banco com os
 * valores monetários exatos, e passar por `JSON.parse` e `JSON.stringify`
 * trocaria `numeric` por `double` no arquivo que é a saída de emergência.
 */
export const fetchExport = async (): Promise<string> => {
  const response = await fetch('/api/data/export');
  if (!response.ok) throw new Error(`A api respondeu ${response.status} ao exportar`);
  return response.text();
};

export const deleteAllData = (confirmation: string): Promise<unknown> =>
  request(
    '/api/data',
    { parse: (value) => value },
    {
      method: 'DELETE',
      body: JSON.stringify({ confirmation }),
    },
  );
