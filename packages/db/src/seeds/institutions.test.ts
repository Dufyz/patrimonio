import { describe, expect, it } from 'vitest';

import {
  mergeInstitutionNames,
  parseCsv,
  parseCvmIntermediaries,
  parseStrParticipants,
} from './institutions.js';

describe('parseCsv', () => {
  it('lê ponto e vírgula, aspas e BOM', () => {
    const rows = parseCsv('﻿a;b\r\n"x;y";"z ""w"""\r\n');

    expect(rows).toEqual([
      ['a', 'b'],
      ['x;y', 'z "w"'],
    ]);
  });

  it('detecta a vírgula como separador', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('participantes do STR', () => {
  it('usa o nome reduzido e pula a linha de título', () => {
    const text = [
      'Participantes do STR;;',
      'ISPB;Nome_Reduzido;Número_Código;Nome_Ext',
      '00000000;BCO DO BRASIL S.A.;001;Banco do Brasil S.A.',
      '00000208;BRB - BCO DE BRASILIA S.A.;070;BRB',
    ].join('\n');

    expect(parseStrParticipants(text)).toEqual([
      'BCO DO BRASIL S.A.',
      'BRB - BCO DE BRASILIA S.A.',
    ]);
  });

  it('sem cabeçalho de nome, não inventa linhas', () => {
    expect(parseStrParticipants('a;b\n1;2')).toEqual([]);
  });
});

describe('intermediários da CVM', () => {
  const text = [
    'CNPJ;DENOM_SOCIAL;DENOM_COMERC;SIT',
    '1;XP INVESTIMENTOS CCTVM S/A;XP INVESTIMENTOS;EM FUNCIONAMENTO NORMAL',
    '2;CORRETORA ANTIGA LTDA;;CANCELADA',
    '3;ORAMA DTVM S.A.;;EM FUNCIONAMENTO NORMAL',
  ].join('\n');

  it('fica com o nome comercial, ou a razão social, só de quem funciona', () => {
    expect(parseCvmIntermediaries(text)).toEqual([
      'XP INVESTIMENTOS',
      'ORAMA DTVM S.A.',
    ]);
  });
});

describe('mergeInstitutionNames', () => {
  it('junta sem repetir, ignorando caixa e acento, em ordem alfabética', () => {
    expect(
      mergeInstitutionNames(['Banco Itaú', 'BANCO INTER'], ['banco itau', 'Nu Pagamentos']),
    ).toEqual(['BANCO INTER', 'Banco Itaú', 'Nu Pagamentos']);
  });
});
