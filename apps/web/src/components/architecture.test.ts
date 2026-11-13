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

const PENDING_MERGE: readonly string[] = [
  // A tabela das telas de Finanças, a fundir com `components/table.tsx` (CMP-03).
  'finance/components/fin_table.tsx',
];

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
