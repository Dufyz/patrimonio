import { describe, expect, it } from 'vitest';

import { adjustForEvents } from './adjusted.js';
import type { PriceEvent, PricePoint } from './adjusted.js';

const serie: readonly PricePoint[] = [
  { price_date: '2015-03-12', close: '64.82' },
  { price_date: '2018-06-01', close: '70.00' },
  { price_date: '2026-10-06', close: '32.41' },
];

/** Desdobramento 1:2 em 2018: uma ação virou duas, e o preço caiu pela metade. */
const desdobramento: PriceEvent = {
  record_date: '2018-07-02',
  ratio_from: '1',
  ratio_to: '2',
};

/** Grupamento 10:1: dez ações viraram uma, e o preço multiplicou por dez. */
const grupamento: PriceEvent = {
  record_date: '2020-05-04',
  ratio_from: '10',
  ratio_to: '1',
};

describe('a série ajustada é para o gráfico, não para o patrimônio', () => {
  it('o preço de hoje nunca é ajustado: ele é o preço real', () => {
    const { points } = adjustForEvents(serie, [desdobramento]);

    const hoje = points.at(-1);
    expect(hoje?.close).toBe('32.41');
    expect(hoje?.adjusted_close).toBe('32.41000000');
    expect(hoje?.factor).toBe('1.00000000');
  });

  it('desdobramento 1:2 divide o preço anterior por dois', () => {
    const { points } = adjustForEvents(serie, [desdobramento]);

    expect(points[0]?.close).toBe('64.82');
    expect(points[0]?.adjusted_close).toBe('32.41000000');
  });

  it('grupamento 10:1 multiplica o preço anterior por dez', () => {
    const { points } = adjustForEvents(
      [{ price_date: '2019-01-02', close: '3.20' }, { price_date: '2026-10-06', close: '32.00' }],
      [grupamento],
    );

    expect(points[0]?.adjusted_close).toBe('32.00000000');
  });

  it('dois eventos compõem: o fator de um ponto é o produto dos posteriores', () => {
    const { points } = adjustForEvents(
      [
        { price_date: '2015-03-12', close: '64.82' },
        { price_date: '2019-01-02', close: '32.41' },
        { price_date: '2026-10-06', close: '324.10' },
      ],
      [desdobramento, grupamento],
    );

    // 2015 está antes dos dois: 1/2 × 10 = 5.
    expect(points[0]?.factor).toBe('5.00000000');
    expect(points[0]?.adjusted_close).toBe('324.10000000');
    // 2019 está só antes do grupamento: fator 10.
    expect(points[1]?.factor).toBe('10.00000000');
  });

  it('evento na própria data do preço não ajusta aquele dia', () => {
    // A data-com é o dia em que a quantidade muda: o fechamento daquele dia já
    // é o preço na escala nova.
    const { points } = adjustForEvents(
      [{ price_date: '2018-07-02', close: '35.00' }],
      [desdobramento],
    );

    expect(points[0]?.adjusted_close).toBe('35.00000000');
  });

  it('sem evento nenhum, a série ajustada é a série negociada', () => {
    const { points } = adjustForEvents(serie, []);

    expect(points.map((point) => point.adjusted_close)).toEqual([
      '64.82000000',
      '70.00000000',
      '32.41000000',
    ]);
  });

  it('a lista de fatores aplicados é o que a tabela de eventos do ativo mostra', () => {
    const { applied } = adjustForEvents(serie, [grupamento, desdobramento]);

    expect(applied).toEqual([
      { record_date: '2018-07-02', factor: '0.50000000' },
      { record_date: '2020-05-04', factor: '10.00000000' },
    ]);
  });

  it('razão zero não divide por zero: o fator fica neutro', () => {
    const { points } = adjustForEvents(serie, [
      { record_date: '2018-07-02', ratio_from: '0', ratio_to: '2' },
    ]);

    expect(points[0]?.factor).toBe('1.00000000');
  });

  it('a série sai em ordem de data, qualquer que seja a ordem da entrada', () => {
    const { points } = adjustForEvents(
      [
        { price_date: '2026-10-06', close: '32.41' },
        { price_date: '2015-03-12', close: '64.82' },
      ],
      [],
    );

    expect(points.map((point) => point.price_date)).toEqual([
      '2015-03-12',
      '2026-10-06',
    ]);
  });

  it('alternar entre ajustada e negociada não muda nenhum dado gravado', () => {
    // As duas séries saem da mesma entrada: `close` é o que está no banco e
    // continua intocado, e `adjusted_close` é derivado na leitura.
    const { points } = adjustForEvents(serie, [desdobramento, grupamento]);

    expect(points.map((point) => point.close)).toEqual([
      '64.82',
      '70.00',
      '32.41',
    ]);
  });
});
