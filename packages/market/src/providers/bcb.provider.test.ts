import { FormatChangedError, MarketDataUnavailableError } from '@patrimonio/application';
import { dailyFactorsFrom } from '@patrimonio/calc';
import type { IndexObservation } from '@patrimonio/calc';
import { accumulate } from '@patrimonio/calc';
import type { DateOnly } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import { counting, fixture, replying, routing } from '../testing/recorded.js';
import { createBcbProvider, sgsUrl } from './bcb.provider.js';

const CDI = fixture('bcb/sgs-12-cdi.json');
const IPCA = fixture('bcb/sgs-433-ipca.json');
const SELIC = fixture('bcb/sgs-11-selic.json');

const FROM = '2024-03-01' as DateOnly;
const TO = '2024-03-08' as DateOnly;

const todas = routing({
  'sgs.12': CDI,
  'sgs.11': SELIC,
  'sgs.433': IPCA,
});

describe('o endereço da série', () => {
  it('pede o intervalo em data brasileira, que é o que o SGS aceita', () => {
    const url = sgsUrl(12, FROM, TO);

    expect(url).toContain('bcdata.sgs.12/dados');
    expect(url).toContain('dataInicial=01/03/2024');
    expect(url).toContain('dataFinal=08/03/2024');
  });
});

describe('resposta normal', () => {
  it('a série 12 vem como taxa do dia, e o provedor diz isso', async () => {
    const provider = createBcbProvider({ http: replying(CDI) });

    const result = await provider.fetchSeries(['CDI'], FROM, TO);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value).toHaveLength(6);
    expect(result.value[0]).toEqual({
      index_code: 'CDI',
      reference_date: '2024-03-01',
      unit: 'daily_pct',
      raw_value: '0.041957',
    });
  });

  it('a série 433 vem como variação do mês', async () => {
    const provider = createBcbProvider({ http: replying(IPCA) });

    const result = await provider.fetchSeries(['IPCA'], FROM, TO);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value[0]?.unit).toBe('monthly_pct');
    expect(result.value[0]?.raw_value).toBe('0.42');
  });

  it('data em DD/MM/YYYY é lida sem deslocar um dia', async () => {
    const provider = createBcbProvider({ http: replying(CDI) });

    const result = await provider.fetchSeries(['CDI'], FROM, TO);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.map((sample) => sample.reference_date)).toEqual([
      '2024-03-01',
      '2024-03-04',
      '2024-03-05',
      '2024-03-06',
      '2024-03-07',
      '2024-03-08',
    ]);
  });

  it('uma requisição por série, com o intervalo inteiro', async () => {
    const script = counting(todas);
    const provider = createBcbProvider({ http: script.http });

    await provider.fetchSeries(['CDI', 'SELIC', 'IPCA'], FROM, TO);

    // Três chamadas para dez anos de três séries, não 2.500 por série. É o que
    // torna a carga inicial de graça.
    expect(script.calls()).toBe(3);
  });

  it('índice que o Banco Central não serve é ignorado sem erro', async () => {
    const provider = createBcbProvider({ http: replying(CDI) });

    const result = await provider.fetchSeries(['IBOV'], FROM, TO);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value).toEqual([]);
  });

  it('campo novo e desconhecido na resposta é ignorado', async () => {
    const provider = createBcbProvider({
      http: replying('[{"data":"01/03/2024","valor":"0.041957","revisado":false}]'),
    });

    const result = await provider.fetchSeries(['CDI'], FROM, TO);

    expect(result.isSuccess()).toBe(true);
  });
});

describe('o acumulado bate com a calculadora do Banco Central', () => {
  it('seis dias de CDI acumulam o produto dos fatores publicados', async () => {
    const provider = createBcbProvider({ http: replying(CDI) });
    const result = await provider.fetchSeries(['CDI'], FROM, TO);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;

    const businessDays = result.value.map((sample) => sample.reference_date);
    const factors = dailyFactorsFrom(
      result.value as readonly IndexObservation[],
      businessDays,
    );

    // 1,00041957^5 × 1,0003927 — cinco dias a 0,041957% e um a 0,039270%.
    expect(accumulate(factors.map((row) => row.daily_factor))).toBe('1.002493135646');
  });
});

describe('os sete casos de mudança de formato', () => {
  const quebrado = async (body: string) => {
    const provider = createBcbProvider({ http: replying(body) });

    return provider.fetchSeries(['CDI'], FROM, TO);
  };

  it('campo ausente: a série sem `valor`', async () => {
    const result = await quebrado('[{"data":"01/03/2024"}]');

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value).toBeInstanceOf(FormatChangedError);
    expect((result.value as FormatChangedError).field).toBe('sgs.12[0].valor');
  });

  it('tipo trocado: `valor` como objeto', async () => {
    const result = await quebrado('[{"data":"01/03/2024","valor":{"n":1}}]');

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value).toBeInstanceOf(FormatChangedError);
  });

  it('casa decimal diferente é aceita: o valor é o mesmo', async () => {
    const result = await quebrado('[{"data":"01/03/2024","valor":"0.0419"}]');

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value[0]?.raw_value).toBe('0.0419');
  });

  it('vírgula por ponto é aceita: o valor é o mesmo', async () => {
    const result = await quebrado('[{"data":"01/03/2024","valor":"0,041957"}]');

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value[0]?.raw_value).toBe('0.041957');
  });

  it('data em outro formato falha nomeando o campo', async () => {
    const result = await quebrado('[{"data":"2024.03.01","valor":"0.041957"}]');

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect((result.value as FormatChangedError).field).toBe('sgs.12[0].data');
  });

  it('envelope alterado: a lista virou objeto', async () => {
    const result = await quebrado('{"dados":[{"data":"01/03/2024","valor":"0.04"}]}');

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect((result.value as FormatChangedError).field).toBe('sgs.12');
    expect(result.value.message).toMatch(/não é uma lista/);
  });

  it('corpo vazio falha, e não devolve série vazia', async () => {
    const result = await quebrado('');

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect((result.value as FormatChangedError).field).toBe('sgs.12.body');
  });

  it('nenhum valor é gravado quando o formato não é reconhecido', async () => {
    // A primeira linha está boa e a segunda não: o lote inteiro é recusado, em
    // vez de gravar metade.
    const result = await quebrado(
      '[{"data":"01/03/2024","valor":"0.041957"},{"data":"04/03/2024","valor":"x"}]',
    );

    expect(result.isFailure()).toBe(true);
  });

  it('formato mudado é definitivo: o job para em vez de insistir', async () => {
    const result = await quebrado('[{"data":"01/03/2024"}]');

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value.isTransient).toBe(false);
    expect(result.value.statusCode).toBe(400);
  });
});

describe('fonte fora do ar', () => {
  it('o erro de infraestrutura sobe como transitório, sem virar série vazia', async () => {
    const provider = createBcbProvider({
      http: async () => failure(new MarketDataUnavailableError('bcb respondeu 503')),
    });

    const result = await provider.fetchSeries(['CDI'], FROM, TO);

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value.isTransient).toBe(true);
  });

  it('a segunda série falhando descarta o lote: meia coleta não é coleta', async () => {
    let chamada = 0;

    const provider = createBcbProvider({
      http: async (request) => {
        chamada += 1;
        if (request.url.includes('sgs.11')) {
          return failure(new MarketDataUnavailableError('fora do ar'));
        }

        return success({ status: 200, body: CDI });
      },
    });

    const result = await provider.fetchSeries(['CDI', 'SELIC'], FROM, TO);

    expect(result.isFailure()).toBe(true);
    expect(chamada).toBe(2);
  });
});
