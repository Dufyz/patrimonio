import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * CMP-12 · Cada componente base existe uma vez.
 *
 * Período, tabela, barra de ferramentas, filtro e efeito vivem em `components/`.
 * Um segundo componente com esse papel, criado em qualquer outro lugar, falha
 * aqui. As duplicatas que ainda restam nas telas de Finanças estão listadas em
 * `PENDING_MERGE`: a lista só encolhe — apagar o arquivo sem tirá-lo daqui
 * também falha, para a dívida nunca ficar escondida.
 */
const ROOT = join(process.cwd(), 'src');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

const BASE_PATTERN =
  /export const (\w*(?:PeriodControl|EffectTable|TableToolbar|FilterBar|DataTable))\b/gu;

/** Tabela, período, ferramentas, filtro e efeito: o módulo único. */
const MODULE = 'components/';

const PENDING_MERGE: readonly string[] = [];

const files = walk(ROOT).map((file) => relative(ROOT, file));

describe('componentes base existem uma vez (CMP-12)', () => {
  const definitions = files.flatMap((file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    return [...text.matchAll(BASE_PATTERN)].map((match) => ({
      name: match[1] ?? '',
      file,
    }));
  });

  it('período, tabela, barra de ferramentas, filtro e efeito só nascem em components/', () => {
    const outside = definitions.filter(
      (definition) =>
        !definition.file.startsWith(MODULE) && !PENDING_MERGE.includes(definition.file),
    );
    expect(outside, JSON.stringify(outside)).toEqual([]);
  });

  it('nenhum nome de componente base é definido em dois arquivos', () => {
    const seen = new Map<string, string>();
    const repeated: string[] = [];
    for (const { name, file } of definitions) {
      const earlier = seen.get(name);
      if (earlier !== undefined && earlier !== file)
        repeated.push(`${name}: ${earlier}, ${file}`);
      seen.set(name, file);
    }
    expect(repeated).toEqual([]);
  });

  it('a lista de fusões pendentes só aponta para arquivos que ainda existem', () => {
    for (const file of PENDING_MERGE) {
      expect(existsSync(join(ROOT, file)), file).toBe(true);
    }
  });

  it('não existem arquivos de período ou efeito fora do módulo', () => {
    const stray = files.filter(
      (file) =>
        !file.startsWith(MODULE) &&
        /(?:period_control|effect_table|table_toolbar|filter_bar)\.tsx?$/u.test(file),
    );
    expect(stray).toEqual([]);
  });
});

/**
 * NAV-13 · O que só existia na separação por áreas não volta.
 *
 * Seletor de áreas, "área ativa" guardada e a casca por área saíram; o teste
 * falha se um arquivo ou símbolo com esses nomes reaparecer.
 */
describe('estrutura de áreas removida (NAV-13)', () => {
  const REMOVED_FILES = [
    'lib/last_area.ts',
    'components/area_selector.tsx',
    'components/area_switcher.tsx',
    'finance/components/finance_shell.tsx',
    'investments',
  ];

  it('os arquivos e pastas removidos não existem', () => {
    const back = REMOVED_FILES.filter((path) => existsSync(join(ROOT, path)));
    expect(back).toEqual([]);
  });

  it('nenhum código guarda ou lê uma "área ativa"', () => {
    const offenders = files.filter((file) =>
      /\b(?:lastArea|activeArea|setActiveArea|AreaSelector|AreaSwitcher)\b/u.test(
        readFileSync(join(ROOT, file), 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * CMP-03 · Tabela sem rolagem horizontal: as colunas somem por prioridade em
 * larguras menores. O único `overflow-x-auto` que resta é o da tabela de efeito
 * do modal, que tem largura própria.
 */
describe('tabelas sem rolagem horizontal (CMP-03)', () => {
  const ALLOWED = new Set(['components/entry_provider.tsx']);

  it('nenhuma tela ou componente envolve tabela em overflow-x-auto', () => {
    const offenders = files.filter(
      (file) =>
        !ALLOWED.has(file) &&
        /overflow-x-auto/u.test(readFileSync(join(ROOT, file), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

describe('uma só família de tabela (CMP-03)', () => {
  it('o DataTable monta cabeçalho, células e total com as peças de table_parts', () => {
    const source = readFileSync(join(ROOT, 'components/table.tsx'), 'utf8');
    expect(source).toMatch(/from '\.\/table_parts\.js'/u);
    expect(source).not.toMatch(/<table\b|<th\b/u);
  });
});

describe('VGR-20 · uma só Visão geral', () => {
  it('as telas antigas de Finanças não voltam: só resta o painel do escopo Fluxo', () => {
    const dir = join(import.meta.dirname, '..', 'finance', 'screens');
    const files = readdirSync(dir).filter((name) => !name.includes('.test.'));
    expect(files).toEqual(['overview_screen.tsx']);
  });
});
