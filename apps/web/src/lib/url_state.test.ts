import { describe, expect, it } from 'vitest';

import { DEFAULT_PERIOD } from './period.js';
import type { CodecMap } from './url_state.js';
import {
  clearParams,
  enumParam,
  listParam,
  periodParam,
  readParams,
  textParam,
  writeParams,
} from './url_state.js';

type ScreenState = {
  readonly period: ReturnType<typeof periodParam>['decode'] extends (
    raw: string | null,
  ) => infer T
    ? T
    : never;
  readonly groupBy: 'categoria' | 'instituicao' | 'nenhum';
  readonly classes: readonly string[];
  readonly search: string;
};

const codecs: CodecMap<ScreenState> = {
  period: periodParam(),
  groupBy: enumParam('agrupar', ['categoria', 'instituicao', 'nenhum'], 'categoria'),
  classes: listParam('classe'),
  search: textParam('busca'),
};

const read = (query: string): ScreenState =>
  readParams(new URLSearchParams(query), codecs);

describe('estado dos controles na URL', () => {
  it('a URL vazia dá o estado padrão', () => {
    expect(read('')).toEqual({
      period: DEFAULT_PERIOD,
      groupBy: 'categoria',
      classes: [],
      search: '',
    });
  });

  it('o padrão não é escrito na URL', () => {
    const next = writeParams(new URLSearchParams(), codecs, {
      groupBy: 'categoria',
      period: DEFAULT_PERIOD,
      classes: [],
    });
    expect(next.toString()).toBe('');
  });

  it('o que não é padrão é escrito e volta igual', () => {
    const next = writeParams(new URLSearchParams(), codecs, {
      groupBy: 'instituicao',
      classes: ['acoes', 'fiis'],
      search: 'itub',
    });
    expect(readParams(next, codecs)).toMatchObject({
      groupBy: 'instituicao',
      classes: ['acoes', 'fiis'],
      search: 'itub',
    });
  });

  it('a lista é ordenada, então o mesmo recorte tem a mesma URL', () => {
    const a = writeParams(new URLSearchParams(), codecs, { classes: ['fiis', 'acoes'] });
    const b = writeParams(new URLSearchParams(), codecs, { classes: ['acoes', 'fiis'] });
    expect(a.toString()).toBe(b.toString());
  });

  it('item repetido na URL não vira filtro duplicado', () => {
    expect(read('classe=acoes,acoes,fiis').classes).toEqual(['acoes', 'fiis']);
  });

  it('valor desconhecido em um campo fechado volta ao padrão', () => {
    expect(read('agrupar=setor').groupBy).toBe('categoria');
  });

  it('mudar um controle preserva os outros parâmetros da URL', () => {
    const search = new URLSearchParams('classe=acoes&aba=resumo');
    const next = writeParams(search, codecs, { groupBy: 'instituicao' });

    expect(next.get('aba')).toBe('resumo');
    expect(next.get('classe')).toBe('acoes');
    expect(next.get('agrupar')).toBe('instituicao');
  });

  it('voltar ao padrão apaga o parâmetro em vez de escrevê-lo', () => {
    const search = new URLSearchParams('agrupar=instituicao');
    expect(writeParams(search, codecs, { groupBy: 'categoria' }).has('agrupar')).toBe(
      false,
    );
  });

  it('"limpar tudo" tira os controles e deixa o resto', () => {
    const search = new URLSearchParams('classe=acoes&agrupar=instituicao&aba=resumo');
    const cleared = clearParams(search, codecs);

    expect(cleared.toString()).toBe('aba=resumo');
    expect(readParams(cleared, codecs).classes).toEqual([]);
  });
});
