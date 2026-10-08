import { FormatChangedError } from '@patrimonio/application';
import type { DateOnly } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

import { fixture } from '../testing/recorded.js';
import { formatChanges, probeSources, reportOf } from './probes.js';
import type { FetchLike } from '../http/client.js';

/**
 * A sondagem com `fetch` injetado: aqui ela não toca a rede. O que fala com a
 * internet é `sources.live.test.ts`, que roda só na verificação noturna.
 */
const DATE = '2026-10-06' as DateOnly;
const FROM = '2026-10-01' as DateOnly;

const responding =
  (bodyFor: (url: string) => { status: number; body: string }): FetchLike =>
  async (url) => {
    const answer = bodyFor(url);

    return { status: answer.status, text: async () => answer.body };
  };

const saudavel = responding((url) => {
  if (url.includes('bcdata.sgs'))
    return { status: 200, body: fixture('bcb/sgs-12-cdi.json') };
  if (url.includes('tesourodireto')) {
    return { status: 200, body: fixture('tesouro/treasurybondsinfo.json') };
  }
  if (url.includes('tesourotransparente')) {
    return { status: 200, body: fixture('tesouro/PrecoTaxaTesouroDireto.csv') };
  }

  return { status: 200, body: fixture('brapi/quote-itub4.json') };
});

describe('a bateria de contrato', () => {
  it('todas as fontes respondendo no formato conhecido dá tudo ok', async () => {
    const results = await probeSources({
      fetch: saudavel,
      reference_date: DATE,
      from: FROM,
      tickers: ['ITUB4'],
    });

    expect(results.map((result) => result.source).sort()).toEqual([
      'bcb',
      'brapi',
      'tesouro-direto',
      'tesouro-transparente',
    ]);
    expect(results.every((result) => result.outcome === 'ok')).toBe(true);
    expect(formatChanges(results)).toEqual([]);
  });

  it('formato mudado é separado de fonte fora do ar', async () => {
    const results = await probeSources({
      fetch: responding((url) =>
        url.includes('bcdata.sgs')
          ? { status: 200, body: '[{"data":"01/03/2024"}]' }
          : { status: 503, body: '' },
      ),
      reference_date: DATE,
      from: FROM,
      tickers: ['ITUB4'],
    });

    const bcb = results.find((result) => result.source === 'bcb');
    const brapi = results.find((result) => result.source === 'brapi');

    // O Banco Central respondeu com formato diferente: problema nosso.
    expect(bcb?.outcome).toBe('format_changed');
    expect(bcb?.detail?.field).toBe('sgs.12[0].valor');

    // A brapi está fora do ar: não é notícia, e não abre issue.
    expect(brapi?.outcome).toBe('unavailable');
    expect(formatChanges(results).map((result) => result.source)).toEqual(['bcb']);
  });

  it('o relatório nomeia o campo e o trecho recebido', async () => {
    const results = await probeSources({
      fetch: responding((url) =>
        url.includes('bcdata.sgs')
          ? { status: 200, body: '[{"data":"01/03/2024","valor":"trinta"}]' }
          : { status: 200, body: fixture('brapi/quote-itub4.json') },
      ),
      reference_date: DATE,
      from: FROM,
      tickers: ['ITUB4'],
    });

    const relatorio = reportOf(results);

    expect(relatorio).toContain('bcb: format_changed');
    expect(relatorio).toContain('campo: sgs.12[0].valor');
    expect(relatorio).toContain('recebido: "trinta"');
  });

  it('fonte que responde e não traz cotação é reportada sem ser falha', async () => {
    const results = await probeSources({
      fetch: responding((url) =>
        url.includes('brapi')
          ? { status: 200, body: '{"results":[]}' }
          : { status: 200, body: fixture('bcb/sgs-12-cdi.json') },
      ),
      reference_date: DATE,
      from: FROM,
      tickers: ['ITUB4'],
    });

    const brapi = results.find((result) => result.source === 'brapi');

    expect(brapi?.outcome).toBe('ok');
    expect(brapi?.message).toMatch(/não trouxe cotação/);
  });

  it('o erro de formato que a sondagem classifica é o do pacote', () => {
    const error = new FormatChangedError('brapi', 'results', 'não é uma lista', '{}');

    expect(error.statusCode).toBe(400);
    expect(error.isTransient).toBe(false);
  });
});
