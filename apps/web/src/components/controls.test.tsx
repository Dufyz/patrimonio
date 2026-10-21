import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Period } from '../lib/period.js';
import { AppliedFilters, BenchmarkPicker } from './controls.js';
import { PeriodControl } from './period_control.js';
import { PreferencesProvider } from './preferences.js';

const HOJE = '2026-10-06';

const renderPeriod = (value: Period, onChange = vi.fn()) => {
  render(
    <PreferencesProvider storage={null}>
      <PeriodControl
        value={value}
        onChange={onChange}
        today={HOJE}
        inception="2021-03-15"
      />
    </PreferencesProvider>,
  );
  return onChange;
};

describe('barra de controles', () => {
  it('o período é um botão só, com a altura dos controles', () => {
    renderPeriod({ kind: 'preset', preset: '12m' });
    const trigger = screen.getByRole('button', { name: 'Período: Últimos 12 meses' });
    expect(trigger).toHaveClass('h-control');
  });

  it('o calendário abre com dois meses e atalhos de período comum', async () => {
    const user = userEvent.setup();
    renderPeriod({ kind: 'preset', preset: '12m' });

    await user.click(screen.getByRole('button', { name: /^Período:/ }));

    const dialog = screen.getByRole('dialog', { name: 'Período personalizado' });
    expect(dialog).toBeVisible();
    expect(screen.getByText(/setembro/)).toBeVisible();
    expect(screen.getByText(/outubro/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Últimos 3 meses' })).toBeVisible();
  });

  it('escolher um intervalo devolve o período personalizado', async () => {
    const user = userEvent.setup();
    const onChange = renderPeriod({ kind: 'preset', preset: '12m' });

    await user.click(screen.getByRole('button', { name: /^Período:/ }));
    await user.click(screen.getByRole('button', { name: /, 1 de setembro/ }));
    await user.click(screen.getByRole('button', { name: /, 6 de outubro/ }));
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(onChange).toHaveBeenCalledWith({
      kind: 'custom',
      from: '2026-09-01',
      to: '2026-10-06',
    });
  });

  it('o botão passa a mostrar o intervalo escolhido', () => {
    renderPeriod({ kind: 'custom', from: '2026-09-01', to: '2026-10-06' });
    expect(
      screen.getByRole('button', { name: 'Período: Personalizado' }),
    ).toHaveTextContent('01/09 – 06/10');
  });

  it('o calendário fecha com Esc e devolve o foco ao botão', async () => {
    const user = userEvent.setup();
    renderPeriod({ kind: 'preset', preset: '12m' });

    const trigger = screen.getByRole('button', { name: /^Período:/ });
    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('não dá para escolher um dia no futuro', async () => {
    const user = userEvent.setup();
    renderPeriod({ kind: 'preset', preset: '12m' });
    await user.click(screen.getByRole('button', { name: /^Período:/ }));

    expect(screen.getByRole('button', { name: /, 7 de outubro/ })).toBeDisabled();
  });

  it('filtro aplicado aparece como etiqueta removível', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();

    render(
      <AppliedFilters
        filters={[{ id: 'classe', label: 'Classe: Ações, FIIs', onRemove }]}
        onClearAll={vi.fn()}
      />,
    );

    expect(screen.getByText('Classe: Ações, FIIs')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remover filtro' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('com mais de um filtro aparece "limpar tudo"', () => {
    const { rerender } = render(
      <AppliedFilters
        filters={[{ id: 'a', label: 'Classe: Ações', onRemove: vi.fn() }]}
        onClearAll={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Limpar tudo' })).not.toBeInTheDocument();

    rerender(
      <AppliedFilters
        filters={[
          { id: 'a', label: 'Classe: Ações', onRemove: vi.fn() },
          { id: 'b', label: 'Instituição: Corretora A', onRemove: vi.fn() },
        ]}
        onClearAll={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Limpar tudo' })).toBeVisible();
  });

  it('o gráfico não aceita mais de quatro benchmarks', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <BenchmarkPicker
        options={[
          { id: 'cdi', label: 'CDI' },
          { id: 'ipca6', label: 'IPCA + 6%', locked: true },
          { id: 'ibov', label: 'IBOV' },
          { id: 'ifix', label: 'IFIX' },
          { id: 'misto', label: '50% CDI + 50% IBOV' },
        ]}
        selected={['cdi', 'ipca6', 'ibov', 'ifix']}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByText('50% CDI + 50% IBOV'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('o benchmark da carteira não pode ser desmarcado', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <BenchmarkPicker
        options={[
          { id: 'cdi', label: 'CDI' },
          { id: 'ipca6', label: 'IPCA + 6%', locked: true },
        ]}
        selected={['ipca6']}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByText('IPCA + 6%'));
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByText('CDI'));
    expect(onChange).toHaveBeenCalledWith(['ipca6', 'cdi']);
  });
});
