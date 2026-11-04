import { describe, expect, it } from 'vitest';

import { csvFiles, toCsv, zipStore } from './export_files.js';

describe('CSV', () => {
  it('cabeçalho pela união das colunas, nulo vazio, aspas escapadas', () => {
    const csv = toCsv([
      { a: '1', b: null },
      { a: 'x,"y"', c: { k: 1 } },
    ]);
    expect(csv).toBe(
      String.fromCharCode(0xfeff) + 'a,b,c\r\n1,,\r\n"x,""y""",,"{""k"":1}"\r\n',
    );
  });

  it('um arquivo por tabela', () => {
    const files = csvFiles(
      JSON.stringify({ tables: { asset: [{ id: '1' }], goal: [] } }),
    );
    expect(files.map((file) => file.name)).toEqual(['asset.csv', 'goal.csv']);
  });
});

describe('zip sem compressão', () => {
  it('traz as assinaturas, a contagem de entradas e o conteúdo', () => {
    const zip = zipStore([{ name: 'a.csv', content: 'olá' }], new Date('2026-10-11'));
    const view = new DataView(zip.buffer);

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(1);
    expect(new TextDecoder().decode(zip.slice(30 + 5, 30 + 5 + 4))).toBe('olá');
  });

  it('CRC32 de "123456789" é cbf43926', () => {
    const zip = zipStore([{ name: 'n', content: '123456789' }]);
    expect(new DataView(zip.buffer).getUint32(14, true)).toBe(0xcbf43926);
  });
});
