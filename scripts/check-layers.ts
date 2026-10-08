/**
 * A regra de camada é declarada no package.json de cada pacote. O node_modules
 * isolado do pnpm já impede o import de um pacote não declarado — este script
 * cobre o outro lado: declarar uma dependência que a camada não permite.
 *
 * Roda antes do `turbo typecheck`, então a violação quebra a verificação no CI.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `fileURLToPath`, e não `.pathname`: o caminho de uma URL vem percent-encoded, e
 * uma pasta chamada `Patrimônio` chega como `Patrimo%CC%82nio`. O resto do
 * repositório já usa `fileURLToPath` nos três lugares em que resolve caminho de
 * arquivo; este era o único que não.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCOPE = '@patrimonio/';

/** Dependências internas que cada pacote pode declarar. Nada fora da lista. */
const ALLOWED: Record<string, readonly string[]> = {
  // Utilitário puro: o Either e nada mais. Sem dependência, nem interna nem externa.
  shared: [],
  // Fonte única de process.env. Nunca importado por apps/web.
  env: [],
  // Tipos, enums, parsers e a máquina de estados do pipeline.
  domain: ['shared'],
  // O motor financeiro: sem banco, sem HTTP, sem relógio.
  calc: ['shared'],
  // O contrato HTTP. Roda no navegador, então só zod e domain.
  contracts: ['domain'],
  // O que o sistema faz, sem saber onde os dados moram.
  // Não lista db, nem queue, nem market: a implementação é injetada.
  application: ['domain', 'calc', 'shared'],
  // Implementa as interfaces de application sobre postgres.
  db: ['application', 'domain', 'shared', 'env'],
  // Transporte. Nenhum caso de uso o importa.
  queue: ['domain', 'shared', 'env'],
  // Provedores atrás da interface MarketDataProvider.
  market: ['application', 'calc', 'domain', 'shared', 'env'],
  exporter: ['domain', 'shared'],
  // A api não fala com o Redis no caminho de negócio: o pedido de trabalho vai
  // para a outbox. `queue` entra aqui só para montar o Bull Board em /api/queues.
  // `market` entra só pelo teto de requisições do plano, que a tela de dados
  // de mercado mostra: a coleta é do worker, e a api não fala com provedor.
  api: ['application', 'contracts', 'db', 'domain', 'env', 'market', 'queue', 'shared'],
  worker: ['application', 'calc', 'db', 'domain', 'env', 'market', 'queue', 'shared'],
  // Roda no navegador: só o contrato e o domínio.
  web: ['contracts', 'domain'],
};

type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const violations: string[] = [];

for (const group of ['apps', 'packages'] as const) {
  for (const dir of readdirSync(join(ROOT, group))) {
    const manifestPath = join(ROOT, group, dir, 'package.json');
    let manifest: Manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    } catch {
      violations.push(`${group}/${dir} não tem package.json`);
      continue;
    }

    if (manifest.name !== `${SCOPE}${dir}`) {
      violations.push(
        `${group}/${dir}: nome é "${manifest.name}", esperado "${SCOPE}${dir}"`,
      );
    }

    const allowed = ALLOWED[dir];
    if (!allowed) {
      violations.push(`${group}/${dir}: pacote sem regra de camada declarada em ALLOWED`);
      continue;
    }

    const declared = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }).filter((name) => name.startsWith(SCOPE));

    for (const dependency of declared) {
      const target = dependency.slice(SCOPE.length);
      if (!allowed.includes(target)) {
        violations.push(
          `${group}/${dir} declara ${dependency}, que a camada não permite ` +
            `(permitido: ${allowed.map((a) => SCOPE + a).join(', ') || 'nenhum'})`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Regra de dependência violada:\n`);
  for (const violation of violations) process.stderr.write(`  · ${violation}\n`);
  process.exit(1);
}

process.stdout.write('Regra de dependência entre camadas: ok\n');
