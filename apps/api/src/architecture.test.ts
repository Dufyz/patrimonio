import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** QUA-07 · o que o produto decidiu não ter também vale para a API: sem login e sem importação. */
const routesDir = join(import.meta.dirname, 'presentation', 'routes');

const routeFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name.endsWith('.routes.ts') ? [path] : [];
  });

const declared = routeFiles(routesDir)
  .flatMap(
    (file) =>
      readFileSync(file, 'utf8').match(
        /router\.(get|post|put|patch|delete)\(\s*'[^']+'/g,
      ) ?? [],
  )
  .map((call) => call.replace(/^router\.\w+\(\s*/, '').replaceAll("'", ''));

describe('rotas que o produto decidiu não ter (QUA-07)', () => {
  it('encontra as rotas declaradas', () => {
    expect(declared.length).toBeGreaterThan(50);
  });

  it('não há login, sessão, usuário nem token', () => {
    expect(
      declared.filter((p) =>
        /\b(login|logout|signup|session|users?|auth|token)\b/i.test(p),
      ),
    ).toEqual([]);
  });

  it('não há importação de extratos, notas ou arquivos', () => {
    expect(
      declared.filter((p) => /\b(import|upload|ofx|nota-corretagem)\b/i.test(p)),
    ).toEqual([]);
  });

  it('não há cripto', () => {
    expect(declared.filter((p) => /\b(crypto|cripto|bitcoin|wallet)\b/i.test(p))).toEqual(
      [],
    );
  });
});
