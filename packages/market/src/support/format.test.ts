import { FormatChangedError } from '@patrimonio/application';
import { describe, expect, it } from 'vitest';

import {
  asArray,
  asJson,
  asObject,
  at,
  dateField,
  decimalField,
  optionalDateField,
  parsing,
  stringField,
} from './format.js';

const read = <T>(body: unknown, pick: (source: Record<string, unknown>) => T) =>
  parsing('fonte', () => pick(asObject(body, 'body')));

describe('número publicado pela fonte', () => {
  it('ponto, vírgula e número são o mesmo valor', () => {
    for (const close of ['32.41', '32,41', 32.41]) {
      const result = read({ close }, (source) => decimalField(source, 'close'));

      expect(result.isSuccess()).toBe(true);
      if (!result.isSuccess()) continue;
      expect(result.value).toBe('32.41');
    }
  });

  it('casa decimal a mais ou a menos não é mudança de formato', () => {
    for (const [close, expected] of [
      ['32.4', '32.4'],
      ['32.410000', '32.410000'],
      ['32', '32'],
    ] as const) {
      const result = read({ close }, (source) => decimalField(source, 'close'));

      expect(result.isSuccess()).toBe(true);
      if (!result.isSuccess()) continue;
      expect(result.value).toBe(expected);
    }
  });

  it('separador de milhar com vírgula decimal é lido sem perder a ordem de grandeza', () => {
    const result = read({ close: '1.234,56' }, (source) => decimalField(source, 'close'));

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value).toBe('1234.56');
  });

  it.each([
    ['texto que não é número', 'trinta e dois'],
    ['vazio', ''],
    ['nulo', null],
    ['objeto', { valor: 32 }],
    ['infinito', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('%s falha nomeando o campo, em vez de virar preço', (_label, value) => {
    const result = read({ close: value }, (source) => decimalField(source, 'close'));

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value).toBeInstanceOf(FormatChangedError);
    expect(result.value.field).toBe('close');
  });
});

describe('os sete casos de mudança de formato', () => {
  it('campo ausente', () => {
    const result = read({ price_date: '2026-10-06' }, (source) =>
      decimalField(source, 'close'),
    );

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value.field).toBe('close');
    expect(result.value.received).toBe('ausente');
  });

  it('tipo trocado', () => {
    const result = read({ ticker: 4 }, (source) => stringField(source, 'ticker'));

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value.message).toMatch(/ticker não é texto/);
  });

  it('casa decimal diferente é tolerada: o valor é o mesmo', () => {
    const result = read({ close: '32.4100' }, (source) => decimalField(source, 'close'));

    expect(result.isSuccess()).toBe(true);
  });

  it('vírgula por ponto é tolerada: o valor é o mesmo', () => {
    const result = read({ close: '32,41' }, (source) => decimalField(source, 'close'));

    expect(result.isSuccess()).toBe(true);
  });

  it('data em outro formato', () => {
    const brasileira = read({ d: '06/10/2026' }, (source) => dateField(source, 'd'));
    expect(brasileira.isSuccess()).toBe(true);
    if (brasileira.isSuccess()) expect(brasileira.value).toBe('2026-10-06');

    const comHora = read({ d: '2026-10-06T18:30:00Z' }, (source) =>
      dateField(source, 'd'),
    );
    expect(comHora.isSuccess()).toBe(true);

    const desconhecida = read({ d: '6 de outubro' }, (source) => dateField(source, 'd'));
    expect(desconhecida.isFailure()).toBe(true);
    if (!desconhecida.isFailure()) return;
    expect(desconhecida.value.field).toBe('d');
  });

  it('envelope alterado falha nomeando o caminho que não existe mais', () => {
    const body = { data: { items: [] } };

    const result = parsing('fonte', () =>
      asArray(at(asObject(body, 'body'), ['data', 'results']), 'data.results'),
    );

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value.field).toBe('data.results');
    expect(result.value.message).toMatch(/não está na resposta/);
  });

  it('corpo vazio', () => {
    const result = parsing('fonte', () => asJson(''));

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value.field).toBe('body');
    expect(result.value.message).toMatch(/veio vazio/);
  });
});

describe('o erro carrega diagnóstico, não só a mensagem', () => {
  it('nomeia a fonte, o campo e o trecho recebido', () => {
    const result = read({ close: 'trinta' }, (source) => decimalField(source, 'close'));

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value.source).toBe('fonte');
    expect(result.value.field).toBe('close');
    expect(result.value.received).toBe('"trinta"');
    expect(result.value.toJSON()).toMatchObject({
      name: 'FormatChangedError',
      statusCode: 400,
      field: 'close',
    });
  });

  it('o trecho é recortado: um corpo de um mega não entra no log inteiro', () => {
    const result = read({ close: 'x'.repeat(5_000) }, (source) =>
      decimalField(source, 'close'),
    );

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value.received.length).toBeLessThan(600);
    expect(result.value.received.endsWith('…')).toBe(true);
  });

  it('campo opcional ausente não é mudança de formato', () => {
    const result = read({}, (source) => optionalDateField(source, 'payment_date'));

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value).toBeNull();
  });

  it('campo novo e desconhecido é ignorado, não derruba a coleta', () => {
    const result = read({ close: '32.41', novoCampoDaFonte: { a: 1 } }, (source) =>
      decimalField(source, 'close'),
    );

    expect(result.isSuccess()).toBe(true);
  });

  it('exceção inesperada na leitura também vira mudança de formato', () => {
    const result = parsing('fonte', () => {
      throw new TypeError('x.map is not a function');
    });

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value).toBeInstanceOf(FormatChangedError);
    expect(result.value.message).toMatch(/não pôde ser lida/);
  });
});
