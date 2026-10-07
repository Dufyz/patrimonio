import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { success } from '@patrimonio/shared';

import type { HttpClient } from '../http/client.js';

/**
 * O cliente HTTP dos testes: devolve resposta gravada em arquivo, capturada uma
 * vez da API real. Nenhum teste de commit toca a rede — o que fala com a
 * internet é um por provedor, em `*.live.test.ts`, e roda só na verificação
 * noturna.
 *
 * `fileURLToPath`, e não `.pathname`: o caminho de uma URL vem percent-encoded,
 * e a pasta `Patrimônio` chega como `Patrimo%CC%82nio`.
 */
export const fixture = (relative: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../__fixtures__/${relative}`, import.meta.url)),
    'utf8',
  );

/** Responde o mesmo corpo a qualquer URL. */
export const replying = (body: string): HttpClient =>
  async () =>
    success({ status: 200, body });

/**
 * Responde por correspondência de URL: é o que permite testar um provedor que
 * faz uma chamada por série sem embaralhar as respostas.
 */
export const routing = (routes: Readonly<Record<string, string>>): HttpClient => {
  return async (request) => {
    for (const [pattern, body] of Object.entries(routes)) {
      if (request.url.includes(pattern)) return success({ status: 200, body });
    }

    return success({ status: 200, body: '[]' });
  };
};

/** Conta as chamadas, para o teste de orçamento de requisições. */
export const counting = (
  client: HttpClient,
): { readonly http: HttpClient; readonly calls: () => number } => {
  let calls = 0;

  return {
    calls: () => calls,
    http: async (request) => {
      calls += 1;

      return client(request);
    },
  };
};
