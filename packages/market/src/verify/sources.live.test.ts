import { describe, expect, it } from 'vitest';

import { formatChanges, probeSources, reportOf } from './probes.js';

/**
 * **Este arquivo fala com a internet.** Ele roda só na verificação noturna, por
 * `pnpm test:live`, e está fora do `include` da suíte de commit — um teste de
 * commit que depende de a brapi estar no ar é um teste que ensina a equipe a
 * ignorar vermelho.
 *
 * O que ele mede: o formato das respostas reais ainda é o que os provedores
 * conhecem. Fonte fora do ar **não** falha — isso não é notícia, e falhar por
 * isso transformaria o detector num gerador de ruído. Formato mudado falha,
 * nomeando o campo e guardando o trecho recebido.
 *
 * É a diferença entre um app que avisa e um app que mostra patrimônio errado.
 */
const REFERENCE_DATE = process.env['LIVE_REFERENCE_DATE'] ?? '';
const FROM = process.env['LIVE_FROM'] ?? '';

const skip = REFERENCE_DATE === '' || FROM === '';

describe.skipIf(skip)('as fontes reais ainda têm o formato que conhecemos', () => {
  it('nenhuma fonte mudou de formato', async () => {
    const results = await probeSources({
      reference_date: REFERENCE_DATE as `${number}-${number}-${number}`,
      from: FROM as `${number}-${number}-${number}`,
      ...(process.env['MARKET_BRAPI_TOKEN'] === undefined
        ? {}
        : { brapiToken: process.env['MARKET_BRAPI_TOKEN'] }),
    });

    const relatorio = reportOf(results);
    const mudancas = formatChanges(results);

    // O relatório no log mesmo quando passa: é o que diz quais fontes
    // responderam, e é ele que vai para o corpo da issue quando falha.
    expect(relatorio).toBeTypeOf('string');

    if (mudancas.length > 0) {
      throw new Error(`formato mudou em ${mudancas.length} fonte(s):\n${relatorio}`);
    }

    expect(mudancas).toEqual([]);
  }, 120_000);
});
