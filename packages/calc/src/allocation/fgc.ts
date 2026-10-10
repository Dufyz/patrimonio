import { Decimal } from 'decimal.js';

/**
 * O teto do FGC é por emissor, não por corretora: três CDBs do mesmo banco em
 * três corretoras diferentes somam para o mesmo limite. Por isso a conta é
 * sobre a instituição emissora, e não sobre onde o título está custodiado.
 */
export type FgcHeadroom = {
  readonly limit_brl: string;
  readonly exposure_brl: string;
  readonly available_brl: string;
  readonly over_limit: boolean;
};

export const fgcHeadroom = (exposure: string, limit: string): FgcHeadroom => {
  const used = new Decimal(exposure);
  const ceiling = new Decimal(limit);

  return {
    limit_brl: ceiling.toFixed(2),
    exposure_brl: used.toFixed(2),
    // Acima do teto o espaço disponível é zero, não um número negativo: o que
    // passou do limite simplesmente não está coberto.
    available_brl: Decimal.max(ceiling.minus(used), 0).toFixed(2),
    over_limit: used.greaterThan(ceiling),
  };
};

/**
 * Quanto do teto já foi usado, em pontos percentuais, para a barra de
 * exposição. Passa de cem quando o emissor passou do limite — a barra se
 * limita a cem, o número diz o quanto passou. O resultado é string porque a
 * tela não faz conta com dinheiro: ela só desenha o que recebeu.
 */
export const fgcUsedPct = (exposure: string, limit: string): string => {
  const ceiling = new Decimal(limit);
  if (ceiling.isZero()) return '0.00';

  return Decimal.max(new Decimal(exposure), 0)
    .dividedBy(ceiling)
    .times(100)
    .toDecimalPlaces(2)
    .toFixed(2);
};
