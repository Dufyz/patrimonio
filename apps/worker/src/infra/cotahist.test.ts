import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RECORD_LENGTH } from '@patrimonio/market';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cotahistAnnualUrl,
  createInstrumentCatalogSource,
  createPriceHistorySource,
} from './cotahist.js';

const record = (
  date: string,
  ticker: string,
  codbdi: string,
  name: string,
  species: string,
) =>
  [
    '01',
    date,
    codbdi,
    ticker.padEnd(12, ' '),
    '010',
    name.padEnd(12, ' '),
    species.padEnd(10, ' '),
    ''.padEnd(3, ' '),
    'R$ '.padEnd(4, ' '),
    '0000000003100',
    '0000000003290',
    '0000000003050',
    '0000000003180',
    '0000000003241',
  ]
    .join('')
    .padEnd(RECORD_LENGTH, ' ');

const FILE = [
  '00COTAHIST.2026BOVESPA 2026123120270104'.padEnd(RECORD_LENGTH, ' '),
  record('20261009', 'ITUB4', '02', 'ITAUUNIBANCO', 'PN      N1'),
  record('20261009', 'BOVA11', '02', 'ISHARES BOVA', 'CI'),
  record('20261009', 'KNRI11', '12', 'FII KINEA RE', 'CI'),
  record('20261009', 'ITUB4F', '96', 'ITAUUNIBANCO', 'PN      N1'),
  '99COTAHIST.2026BOVESPA'.padEnd(RECORD_LENGTH, ' '),
].join('\n');

let directory: string;
let zipped: string | null = null;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'patrimonio-cotahist-test-'));
  await writeFile(join(directory, 'COTAHIST_A2026.TXT'), FILE, 'latin1');

  try {
    execFileSync('zip', ['-q', 'COTAHIST_A2026.ZIP', 'COTAHIST_A2026.TXT'], {
      cwd: directory,
    });
    zipped = join(directory, 'COTAHIST_A2026.ZIP');
  } catch {
    zipped = null;
  }
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const read = async (location: string) =>
  createInstrumentCatalogSource({ year: () => 2026, location }).fetchInstruments();

describe('a fonte do catálogo', () => {
  it('lê o TXT já extraído', async () => {
    const result = await read(join(directory, 'COTAHIST_A2026.TXT'));

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.instruments.map((item) => item.ticker)).toEqual([
      'BOVA11',
      'ITUB4',
      'KNRI11',
    ]);
    expect(result.value.source).toBe('cotahist');
    expect(result.value.last_date).toBe('2026-10-09');
  });

  it('extrai o ZIP antes de ler', async (context) => {
    if (zipped === null) context.skip();

    const result = await read(zipped as string);

    expect(result.isSuccess() && result.value.instruments).toHaveLength(3);
  });

  it('arquivo que não existe é fonte indisponível, não exceção', async () => {
    const result = await read(join(directory, 'nao-existe.TXT'));

    expect(result.isFailure()).toBe(true);
  });

  it('o endereço anual da B3 leva o ano', () => {
    expect(cotahistAnnualUrl(2026)).toContain('COTAHIST_A2026.ZIP');
  });
});

describe('o histórico de fechamentos', () => {
  const history = (location: string) =>
    createPriceHistorySource({ currentYear: () => 2026, locationFor: () => location });

  it('lê só os papéis pedidos, no período, pelo preço negociado', async () => {
    const result = await history(join(directory, 'COTAHIST_A2026.TXT')).fetchRange(
      ['ITUB4'],
      '2026-01-01',
      '2026-12-31',
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes).toEqual([
      { ticker: 'ITUB4', price_date: '2026-10-09', close: '32.41' },
    ]);
    expect(result.value.missing).toEqual([]);
  });

  it('diz quais papéis o arquivo não tem', async () => {
    const result = await history(join(directory, 'COTAHIST_A2026.TXT')).fetchRange(
      ['ITUB4', 'XXXX3'],
      '2026-01-01',
      '2026-12-31',
    );

    expect(result.isSuccess() && result.value.missing).toEqual(['XXXX3']);
  });

  it('o período corta as datas fora dele', async () => {
    const result = await history(join(directory, 'COTAHIST_A2026.TXT')).fetchRange(
      ['ITUB4'],
      '2026-10-10',
      '2026-12-31',
    );

    expect(result.isSuccess() && result.value.quotes).toEqual([]);
  });
});
