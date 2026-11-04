import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORY_CATALOG } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/** As que a 031 deixou no topo; a 032 as leva para o grupo "Outros". */
const ROOTS = ['Ativos Personalizados', 'ETFs', 'Fundos'];

const UUID = /'([0-9a-f-]{36})'/g;

describe('a migration que agrupa as categorias', () => {
  it('põe toda categoria do catálogo plano em um grupo, ou a deixa no topo de propósito', async () => {
    const sql = await readFile(join(HERE, 'up', '031_group_categories.sql'), 'utf8');

    const grouped = [...sql.matchAll(/UPDATE category[\s\S]*?WHERE[\s\S]*?(?:\);|;)/g)]
      .flatMap((statement) => [...statement[0].matchAll(UUID)])
      .map((match) => match[1])
      // O primeiro id de cada UPDATE é o do grupo, no SET.
      .filter((id) => CATEGORY_CATALOG.some((item) => item.id === id));

    const expected = CATEGORY_CATALOG.filter((item) => !ROOTS.includes(item.name)).map(
      (item) => item.id,
    );

    expect([...grouped].sort()).toEqual([...expected].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('o down desfaz o que o up criou', async () => {
    const up = await readFile(join(HERE, 'up', '031_group_categories.sql'), 'utf8');
    const down = await readFile(join(HERE, 'down', '031_group_categories.sql'), 'utf8');

    const created = [
      ...up.matchAll(/\('(01960000-0002-7000-8000-0000000000[23][0-9a-f])'/g),
    ]
      .map((match) => match[1])
      .sort();

    const deleted = down.slice(down.lastIndexOf('DELETE FROM category'));
    const removed = [...deleted.matchAll(UUID)].map((match) => match[1]).sort();

    expect(removed).toEqual(created);
  });

  it('a 032 leva as que ficaram no topo para o grupo Outros', async () => {
    const sql = await readFile(
      join(HERE, 'up', '032_group_other_categories.sql'),
      'utf8',
    );

    const moved = [...sql.matchAll(UUID)]
      .map((match) => match[1])
      .filter((id) => CATEGORY_CATALOG.some((item) => item.id === id))
      .map((id) => CATEGORY_CATALOG.find((item) => item.id === id)?.name)
      .sort();

    expect(moved).toEqual([...ROOTS].sort());
  });
});

describe('as classes padrão', () => {
  it('a 033 deixa cinco classes e leva o que estava em Alternativos para Outros', async () => {
    const up = await readFile(join(HERE, 'up', '033_default_classes.sql'), 'utf8');
    const down = await readFile(join(HERE, 'down', '033_default_classes.sql'), 'utf8');

    expect(up).toContain("'Ações internacionais'");
    expect(up).toMatch(
      /DELETE FROM category WHERE id = '01960000-0002-7000-8000-000000000023'/,
    );
    // O que estava em Alternativos vai para Outros, e o down devolve as mesmas cinco.
    expect([...down.matchAll(UUID)].map((match) => match[1])).toEqual(
      expect.arrayContaining([
        '01960000-0002-7000-8000-000000000007',
        '01960000-0002-7000-8000-000000000008',
        '01960000-0002-7000-8000-00000000000a',
        '01960000-0002-7000-8000-000000000012',
        '01960000-0002-7000-8000-000000000017',
      ]),
    );
  });
});
