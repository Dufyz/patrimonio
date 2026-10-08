import { describe, expect, it } from 'vitest';

import { createHttpClient, excerpt, withRetry } from './client.js';
import type { FetchLike, HttpClient } from './client.js';

const responding = (
  script: readonly { readonly status: number; readonly body?: string }[],
): { readonly fetch: FetchLike; readonly calls: () => number } => {
  let call = 0;

  return {
    calls: () => call,
    fetch: async () => {
      const step = script[Math.min(call, script.length - 1)];
      call += 1;

      return {
        status: step?.status ?? 200,
        text: async () => step?.body ?? '',
      };
    },
  };
};

const client = (fetch: FetchLike): HttpClient =>
  createHttpClient({ fetch, timeoutMs: 1_000, source: 'brapi' });

const noWait = { attempts: 3, backoffMs: 1, sleep: async () => {} };

describe('cliente HTTP dos provedores', () => {
  it('200 devolve o corpo como veio', async () => {
    const result = await client(responding([{ status: 200, body: '{"a":1}' }]).fetch)({
      url: 'https://exemplo/quote',
    });

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.body).toBe('{"a":1}');
  });

  it('429 é transitório: o limite é por janela, e esperar resolve', async () => {
    const result = await client(responding([{ status: 429 }]).fetch)({
      url: 'https://exemplo/quote',
    });

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value.isTransient).toBe(true);
    expect(result.value.message).toMatch(/limite de requisições/);
  });

  it('500 é transitório e 403 é definitivo', async () => {
    const quinhentos = await client(responding([{ status: 500 }]).fetch)({
      url: 'https://exemplo/quote',
    });
    const quatrocentos = await client(
      responding([{ status: 403, body: 'token inválido' }]).fetch,
    )({ url: 'https://exemplo/quote' });

    expect(quinhentos.isFailure() && quinhentos.value.isTransient).toBe(true);
    expect(quatrocentos.isFailure() && quatrocentos.value.isTransient).toBe(false);
  });

  it('falha de rede é tratada como fonte fora do ar', async () => {
    const result = await client(async () => {
      throw new Error('ECONNRESET');
    })({ url: 'https://exemplo/quote' });

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value.isTransient).toBe(true);
    expect(result.value.message).toMatch(/não respondeu/);
  });

  it('o erro nomeia a fonte que não respondeu', async () => {
    const result = await createHttpClient({
      fetch: responding([{ status: 503 }]).fetch,
      timeoutMs: 1_000,
      source: 'bcb',
    })({ url: 'https://exemplo' });

    expect(result.isFailure() && result.value.message.startsWith('bcb')).toBe(true);
  });
});

describe('retentativa', () => {
  it('429 seguido de 200 devolve o 200, sem estourar o limite', async () => {
    const script = responding([{ status: 429 }, { status: 200, body: 'ok' }]);

    const result = await withRetry(
      client(script.fetch),
      noWait,
    )({
      url: 'https://exemplo/quote',
    });

    expect(result.isSuccess()).toBe(true);
    expect(script.calls()).toBe(2);
  });

  it('erro definitivo não é repetido: insistir não muda a resposta', async () => {
    const script = responding([{ status: 404, body: 'não existe' }]);

    const result = await withRetry(
      client(script.fetch),
      noWait,
    )({
      url: 'https://exemplo/quote',
    });

    expect(result.isFailure()).toBe(true);
    expect(script.calls()).toBe(1);
  });

  it('500 persistente para na terceira tentativa e passa adiante', async () => {
    const script = responding([{ status: 500 }]);

    const result = await withRetry(
      client(script.fetch),
      noWait,
    )({
      url: 'https://exemplo/quote',
    });

    expect(result.isFailure()).toBe(true);
    expect(script.calls()).toBe(3);
  });

  it('o backoff cresce entre as tentativas', async () => {
    const esperas: number[] = [];
    const script = responding([{ status: 500 }]);

    await withRetry(client(script.fetch), {
      attempts: 3,
      backoffMs: 100,
      sleep: async (ms) => {
        esperas.push(ms);
      },
    })({ url: 'https://exemplo/quote' });

    expect(esperas).toEqual([100, 200]);
  });
});

describe('recorte do trecho recebido', () => {
  it('corpo curto vai inteiro e corpo longo é recortado com reticência', () => {
    expect(excerpt('curto')).toBe('curto');
    expect(excerpt('x'.repeat(1_000))).toHaveLength(501);
    expect(excerpt('x'.repeat(1_000)).endsWith('…')).toBe(true);
  });
});
