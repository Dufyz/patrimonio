import { describe, expect, it } from 'vitest';

import { bootstrapSteps, runBootstrap } from './bootstrap.js';

const steps = bootstrapSteps({ since: '2021-01-01' });

describe('carga inicial', () => {
  it('roda migrations, instituições, instrumentos, Tesouro, índices e COTAHIST, nessa ordem', () => {
    expect(steps.map((step) => step.id)).toEqual([
      'migrations',
      'institutions',
      'instruments',
      'treasury',
      'indices',
      'cotahist',
    ]);
  });

  it('passa a data inicial aos índices e o ano ao COTAHIST', () => {
    expect(steps.find((step) => step.id === 'indices')?.command).toBe(
      'pnpm seed:indices --desde=2021-01-01',
    );
    expect(steps.find((step) => step.id === 'cotahist')?.args).toContain('--de=2021');
  });

  it('um passo opcional que falha não impede os seguintes, e o resumo diz o que repetir', async () => {
    const lines: string[] = [];
    const ran: string[] = [];

    const outcomes = await runBootstrap(
      steps,
      async (step) => {
        ran.push(step.id);
        return step.id === 'treasury' ? 1 : 0;
      },
      (line) => lines.push(line),
    );

    expect(ran).toEqual(steps.map((step) => step.id));
    expect(
      outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.step.id),
    ).toEqual(['treasury']);
    expect(lines).toContain('  pnpm seed:tesouro');
    expect(lines.some((line) => line.includes('[4/6] Tesouro Direto'))).toBe(true);
  });

  it('um passo obrigatório que falha interrompe a carga', async () => {
    const ran: string[] = [];

    const outcomes = await runBootstrap(
      steps,
      async (step) => {
        ran.push(step.id);
        return step.id === 'institutions' ? 1 : 0;
      },
      () => undefined,
    );

    expect(ran).toEqual(['migrations', 'institutions']);
    expect(outcomes.filter((outcome) => outcome.skipped)).toHaveLength(4);
  });

  it('tudo certo: sem lista de repetição', async () => {
    const lines: string[] = [];

    await runBootstrap(
      steps,
      async () => 0,
      (line) => lines.push(line),
    );

    expect(lines.some((line) => line.includes('Para repetir'))).toBe(false);
  });
});
