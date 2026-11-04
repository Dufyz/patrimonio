import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EffectTable } from './effect_table.js';

describe('EffectTable (Finanças · Modais)', () => {
  it('mostra antes → depois só das linhas que mudam', () => {
    render(
      <EffectTable
        rows={[
          { label: 'Fatura de out/2026', before: 218317, after: 348217 },
          { label: 'Parcelas futuras', before: 0, after: 0 },
        ]}
      />,
    );
    const group = within(screen.getByRole('group', { name: 'Efeito' }));
    expect(group.getByText('Fatura de out/2026')).toBeTruthy();
    expect(group.getByText('R$ 2.183,17')).toBeTruthy();
    expect(group.getByText('R$ 3.482,17')).toBeTruthy();
    expect(group.queryByText('Parcelas futuras')).toBeNull();
  });

  it('não desenha nada quando nada muda', () => {
    const { container } = render(
      <EffectTable rows={[{ label: 'X', before: 5, after: 5 }]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
