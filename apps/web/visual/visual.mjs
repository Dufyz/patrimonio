// QUA-08 · Regressão visual: captura a galeria nos dois temas e em três larguras
// e compara com a linha de base aprovada (visual/baseline).
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
const stop = () => server.kill('SIGTERM');
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

await waitUp();
mkdirSync(BASELINE, { recursive: true });
mkdirSync(DIFF, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});

const failures = [];
for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.addInitScript((t) => localStorage.setItem('patrimonio.theme', t), theme);
    await page.goto(`http://localhost:${PORT}/galeria`);
    await page.waitForLoadState('networkidle');
    await page.addStyleTag({
      content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}',
    });
    const name = `galeria-${theme}-${width}.png`;
    const shot = await page.screenshot({ fullPage: true });
    await page.close();
    const baselineFile = join(BASELINE, name);
    if (update || !existsSync(baselineFile)) {
      writeFileSync(baselineFile, shot);
      continue;
    }
    const a = PNG.sync.read(readFileSync(baselineFile));
    const b = PNG.sync.read(shot);
    if (a.width !== b.width || a.height !== b.height) {
      writeFileSync(join(DIFF, name), shot);
      failures.push(`${name}: tamanho mudou (${a.width}x${a.height} → ${b.width}x${b.height})`);
      continue;
    }
    const diff = new PNG({ width: a.width, height: a.height });
    const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
    const ratio = changed / (a.width * a.height);
    if (ratio > LIMIT) {
      writeFileSync(join(DIFF, name), PNG.sync.write(diff));
      failures.push(`${name}: ${(ratio * 100).toFixed(2)}% dos pixels mudaram`);
    }
  }
}
await browser.close();
stop();

if (failures.length > 0) {
  console.error(`regressão visual:\n  ${failures.join('\n  ')}\nimagens em visual/diff`);
  process.exit(1);
}
console.log(update ? 'linha de base gravada' : 'sem diferença acima do limite');
