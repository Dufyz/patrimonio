import { spawn } from 'node:child_process';

import { toDateOnly } from '@patrimonio/domain';

import { bootstrapSteps, runBootstrap } from '../infra/bootstrap.js';
import type { BootstrapStep } from '../infra/bootstrap.js';

/**
 * `pnpm bootstrap [--desde=AAAA-MM-DD]`
 *
 * A carga inicial de uma instalação nova, em ordem: migrations, instituições,
 * instrumentos listados, Tesouro, índices e histórico de preços. Cada passo
 * imprime o que carregou; se um passo opcional falhar, os outros seguem e o
 * resumo diz o comando que repete só ele. Repetível: cada passo é idempotente.
 *
 * Sem `--desde`, os índices partem de cinco anos atrás.
 */
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const defaultSince = (): string => {
  const today = toDateOnly(new Date());
  return `${Number(today.slice(0, 4)) - 5}-01-01`;
};

const since = flag('desde') ?? defaultSince();

if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  process.stderr.write(`--desde=${since} não é uma data AAAA-MM-DD\n`);
  process.exit(1);
}

const run = (step: BootstrapStep): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn('pnpm', [...step.args], { stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });

const outcomes = await runBootstrap(bootstrapSteps({ since }), run, write);

if (outcomes.some((outcome) => !outcome.ok)) process.exitCode = 1;
