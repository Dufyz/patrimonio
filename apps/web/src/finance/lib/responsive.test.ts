import { describe, expect, it } from 'vitest';

import { COLUMN_PRIORITY, hideBelow } from './responsive.js';

describe('prioridade de coluna (FIN-702)', () => {
  it('quatro níveis, do que some primeiro ao que some por último', () => {
    expect([1, 2, 3, 4].map((level) => hideBelow(level as 1 | 2 | 3 | 4))).toEqual([
      'max-xl:hidden',
      'max-lg:hidden',
      'max-md:hidden',
      'max-sm:hidden',
    ]);
  });

  it('segue a ordem proposta por tela', () => {
    expect(COLUMN_PRIORITY.lancamentos.detalhe).toBeLessThan(
      COLUMN_PRIORITY.lancamentos.conta,
    );
    expect(COLUMN_PRIORITY.lancamentos.conta).toBeLessThan(
      COLUMN_PRIORITY.lancamentos.categoria,
    );
    expect(COLUMN_PRIORITY.recorrentes.lancamento).toBeLessThan(
      COLUMN_PRIORITY.recorrentes.pagamento,
    );
    expect(COLUMN_PRIORITY.recorrentes.pagamento).toBeLessThan(
      COLUMN_PRIORITY.recorrentes.dia,
    );
  });
});
