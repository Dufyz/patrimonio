/**
 * Os passos da carga inicial, na ordem em que um depende do anterior: o schema
 * antes de tudo, as instituições e os catálogos antes de qualquer lançamento, os
 * índices antes do histórico de preços.
 *
 * Cada passo é um comando que também roda sozinho, e é esse comando que a tela de
 * Dados de mercado mostra quando o catálogo está vazio.
 */
export type BootstrapStep = {
  readonly id:
    'migrations' | 'institutions' | 'instruments' | 'treasury' | 'indices' | 'cotahist';
  readonly label: string;
  /** O que o `pnpm` executa, sem o `pnpm` na frente. */
  readonly args: readonly string[];
  /** O comando que a pessoa digita para repetir só este passo. */
  readonly command: string;
  /** Sem o schema ou as instituições, os passos seguintes não têm onde gravar. */
  readonly required: boolean;
};

export type BootstrapOptions = {
  /** A data inicial dos índices e do histórico de preços. */
  readonly since: string;
};

export const bootstrapSteps = (options: BootstrapOptions): readonly BootstrapStep[] => {
  const year = options.since.slice(0, 4);

  return [
    {
      id: 'migrations',
      label: 'Migrations',
      args: ['--filter', '@patrimonio/db', 'migrate', 'up'],
      command: 'pnpm migrate up',
      required: true,
    },
    {
      id: 'institutions',
      label: 'Instituições',
      args: ['--filter', '@patrimonio/db', 'seed:institutions'],
      command: 'pnpm seed:institutions',
      required: true,
    },
    {
      id: 'instruments',
      label: 'Instrumentos listados',
      args: ['--filter', '@patrimonio/worker', 'seed:instruments'],
      command: 'pnpm seed:instruments',
      required: false,
    },
    {
      id: 'treasury',
      label: 'Tesouro Direto',
      args: ['--filter', '@patrimonio/worker', 'seed:tesouro'],
      command: 'pnpm seed:tesouro',
      required: false,
    },
    {
      id: 'indices',
      label: 'Índices',
      args: [
        '--filter',
        '@patrimonio/worker',
        'seed:indices',
        `--desde=${options.since}`,
      ],
      command: `pnpm seed:indices --desde=${options.since}`,
      required: false,
    },
    {
      id: 'cotahist',
      label: 'Histórico de preços (COTAHIST)',
      args: ['--filter', '@patrimonio/worker', 'seed:cotahist', `--de=${year}`],
      command: `pnpm seed:cotahist --de=${year}`,
      required: false,
    },
  ];
};

export type BootstrapOutcome = {
  readonly step: BootstrapStep;
  readonly ok: boolean;
  readonly skipped: boolean;
};

/**
 * Roda os passos em ordem. Um passo obrigatório que falha interrompe a carga; um
 * opcional que falha — a fonte fora do ar, na maioria das vezes — não impede os
 * outros, e o resumo diz qual comando repetir.
 */
export const runBootstrap = async (
  steps: readonly BootstrapStep[],
  run: (step: BootstrapStep) => Promise<number>,
  write: (line: string) => void,
): Promise<readonly BootstrapOutcome[]> => {
  const outcomes: BootstrapOutcome[] = [];
  let stopped = false;

  for (const [index, step] of steps.entries()) {
    if (stopped) {
      outcomes.push({ step, ok: false, skipped: true });
      continue;
    }

    write(`\n[${index + 1}/${steps.length}] ${step.label}`);
    const code = await run(step);
    const ok = code === 0;

    outcomes.push({ step, ok, skipped: false });
    if (!ok && step.required) stopped = true;
  }

  write('\nResumo');
  for (const outcome of outcomes) {
    const mark = outcome.skipped ? 'não rodou' : outcome.ok ? 'ok' : 'falhou';
    write(`  ${mark.padEnd(10)} ${outcome.step.label}`);
  }

  const pending = outcomes.filter((outcome) => !outcome.ok);
  if (pending.length > 0) {
    write('\nPara repetir o que faltou:');
    for (const outcome of pending) write(`  ${outcome.step.command}`);
  }

  return outcomes;
};
