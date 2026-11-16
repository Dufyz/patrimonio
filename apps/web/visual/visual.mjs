// QUA-08 · Regressão visual: captura a galeria e cada tela real (api com o fixture
// unificado de 11/11/2026) nos dois temas e em três larguras, mais a barra
// recolhida (trilho) e a gaveta, e compara com a linha de base (visual/baseline).
//
//   pnpm visual            compara; falha e grava a imagem de diferença em visual/diff
//   pnpm visual --update   grava a linha de base
//
// Usa o Chrome do sistema (CHROME_PATH ou /usr/bin/google-chrome) via playwright-core
// e o servidor do vite; nenhum navegador é baixado.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(here, 'baseline');
const DIFF = join(here, 'diff');
const PORT = 4179;
const WIDTHS = [1440, 1240, 1000];
const THEMES = ['light', 'dark'];
// Fração de pixels diferentes tolerada (antialiasing de fonte).
const LIMIT = 0.002;
const update = process.argv.includes('--update');

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: join(here, '..'),
  stdio: 'ignore',
});
const API_PORT = 3333;
const api = spawn('npx', ['tsx', 'src/testing/visual_server.ts'], {
  cwd: join(here, '..', '..', 'api'),
  stdio: 'ignore',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    WEB_ORIGIN: 'http://localhost:5173',
    DB_CONNECTION:
      process.env.DB_TEST_CONNECTION ??
      'postgres://patrimonio:patrimonio@localhost:5434/patrimonio_test',
    DB_TEST_CONNECTION:
      process.env.DB_TEST_CONNECTION ??
      'postgres://patrimonio:patrimonio@localhost:5434/patrimonio_test',
    REDIS_URL: process.env.REDIS_TEST_URL ?? 'redis://localhost:6380/1',
    VISUAL_API_PORT: String(API_PORT),
  },
});
const stop = () => {
  server.kill('SIGTERM');
  api.kill('SIGTERM');
};
process.on('exit', stop);

const waitUp = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://localhost:${PORT}/galeria`);
      if (res.ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('o servidor do vite não subiu');
};

const waitApi = async () => {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://localhost:${API_PORT}/api/finance/wealth`);
      if (res.ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('a api do visual não subiu');
};

await waitUp();
await waitApi();
mkdirSync(BASELINE, { recursive: true });
mkdirSync(DIFF, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});

const failures = [];

const TODAY = new Date('2026-11-11T15:00:00.000Z');
const SCREENS = [
  ['visao-geral', '/'],
  ['visao-geral-fluxo', '/?escopo=fluxo'],
  ['visao-geral-investimentos', '/?escopo=investimentos'],
  ['lancamentos', '/lancamentos'],
  ['contas', '/contas'],
  ['cartoes', '/cartoes'],
  ['recorrentes', '/recorrentes'],
  ['categorias', '/categorias'],
  ['posicoes', '/carteiras/todas/posicoes'],
  ['objetivos', '/carteiras/todas/objetivos'],
  ['projecao', '/carteiras/todas/projecao'],
  ['configuracoes', '/configuracoes'],
];

const compare = (name, shot) => {
  const baselineFile = join(BASELINE, name);
  if (update || !existsSync(baselineFile)) {
    writeFileSync(baselineFile, shot);
    return;
  }
  const a = PNG.sync.read(readFileSync(baselineFile));
  const b = PNG.sync.read(shot);
  if (a.width !== b.width || a.height !== b.height) {
    writeFileSync(join(DIFF, name), shot);
    failures.push(
      `${name}: tamanho mudou (${a.width}x${a.height} → ${b.width}x${b.height})`,
    );
    return;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.1,
  });
  const ratio = changed / (a.width * a.height);
  if (ratio > LIMIT) {
    writeFileSync(join(DIFF, name), PNG.sync.write(diff));
    failures.push(`${name}: ${(ratio * 100).toFixed(2)}% dos pixels mudaram`);
  }
};

const capture = async ({
  name,
  path,
  theme,
  width,
  collapsed = false,
  drawer = false,
}) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.clock.setFixedTime(TODAY);
  await page.addInitScript(
    ([t, c]) => {
      localStorage.setItem('patrimonio.theme', t);
      localStorage.setItem('patrimonio:sidebar-collapsed', c ? '1' : '0');
    },
    [theme, collapsed],
  );
  await page.goto(`http://localhost:${PORT}${path}`);
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({
    content:
      '*{animation:none!important;transition:none!important;caret-color:transparent!important}',
  });
  if (drawer) {
    await page.getByRole('button', { name: 'Abrir a barra lateral' }).click();
  }
  await page.waitForTimeout(900);
  const shot = await page.screenshot({ fullPage: !drawer });
  await page.close();
  compare(name, shot);
};

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    await capture({
      name: `galeria-${theme}-${width}.png`,
      path: '/galeria',
      theme,
      width,
    });
    for (const [id, path] of SCREENS) {
      await capture({ name: `${id}-${theme}-${width}.png`, path, theme, width });
    }
  }
  // As variantes da casca: trilho recolhido e gaveta (aberta e fechada).
  await capture({
    name: `trilho-${theme}-1440.png`,
    path: '/',
    theme,
    width: 1440,
    collapsed: true,
  });
  await capture({
    name: `gaveta-fechada-${theme}-900.png`,
    path: '/',
    theme,
    width: 900,
  });
  await capture({
    name: `gaveta-aberta-${theme}-900.png`,
    path: '/',
    theme,
    width: 900,
    drawer: true,
  });
}
await browser.close();
stop();

if (failures.length > 0) {
  console.error(`regressão visual:\n  ${failures.join('\n  ')}\nimagens em visual/diff`);
  process.exit(1);
}
console.log(update ? 'linha de base gravada' : 'sem diferença acima do limite');
