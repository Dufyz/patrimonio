import { Decimal } from 'decimal.js';

/**
 * O alvo de alocação é verificado antes de ir ao banco para a tela poder
 * apontar a diferença — "faltam 4 pontos" é acionável, "restrição violada" não.
 * O trigger diferido continua existindo: a verificação do serviço protege o
 * caminho que passa por ele, a do banco protege também a importação.
 */
export type AllocationTarget = {
  readonly category_id: string;
  readonly target_pct: string;
};

export type TargetSum = {
  /** A soma como string, com duas casas, do mesmo jeito que o banco guarda. */
  readonly total_pct: string;
  /** Quanto falta para fechar 100. Negativo quando passou. */
  readonly missing_pp: string;
  /** Zero é "sem estratégia definida", e é um estado legítimo. */
  readonly closes: boolean;
};

export const sumTargets = (targets: readonly AllocationTarget[]): TargetSum => {
  const total = targets.reduce(
    (accumulated, target) => accumulated.plus(new Decimal(target.target_pct)),
    new Decimal(0),
  );

  return {
    total_pct: total.toFixed(2),
    missing_pp: new Decimal(100).minus(total).toFixed(2),
    closes: total.isZero() || total.equals(100),
  };
};

/** Duas linhas para a mesma categoria somariam o alvo sem ninguém ver. */
export const duplicatedCategories = (
  targets: readonly AllocationTarget[],
): readonly string[] => {
  const seen = new Set<string>();
  const duplicated = new Set<string>();

  for (const target of targets) {
    if (seen.has(target.category_id)) duplicated.add(target.category_id);
    seen.add(target.category_id);
  }

  return [...duplicated];
};
