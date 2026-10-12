import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORY_CATALOG } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const ROW =
  /\('([0-9a-f-]{36})', NULL, '([^']+)', '([^']+)', (NULL|'\{[^']*\}'::JSONB), (\d+)\)/g;

describe('a migration do catálogo de categorias', () => {
  it('carrega exatamente o catálogo do domínio', async () => {
    const sql = await readFile(join(HERE, 'up', '026_seed_categories.sql'), 'utf8');

    const rows = [...sql.matchAll(ROW)].map((match) => ({
      id: match[1],
      name: match[2],
      color_token: match[3],
      auto_rule:
        match[4] === 'NULL'
          ? null
          : (JSON.parse(match[4]?.replace(/^'|'::JSONB$/g, '') ?? 'null') as unknown),
      sort_order: Number(match[5]),
    }));

    expect(rows).toEqual(CATEGORY_CATALOG.map((item) => ({ ...item })));
  });

  it('o down remove as mesmas categorias', async () => {
    const down = await readFile(join(HERE, 'down', '026_seed_categories.sql'), 'utf8');
    const ids = [...down.matchAll(/'([0-9a-f-]{36})'/g)].map((match) => match[1]);

    expect(ids).toEqual(CATEGORY_CATALOG.map((item) => item.id));
  });
});
