import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { PeriodControl } from './period_control.js';
import { FinancePeriodProvider, useFinancePeriod } from './period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import type { DateRange } from '../lib/period.js';

const Harness = ({ onRange }: { readonly onRange?: (range: DateRange) => void }) => {
  const [range, setRange] = useState<DateRange>({ from: '2026-10-01', to: '2026-10-31' });
  return (
    <PeriodControl
      value={range}
      today="2026-10-24"
      onChange={(next) => {
        setRange(next);
        onRange?.(next);
      }}
    />
  );
};

describe('controle de período único', () => {
  it('mostra o intervalo do mês corrente no botão', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Período: 01/10 – 31/10' })).toBeVisible();
  });

  it('abre o seletor com os três atalhos e aplica o mês anterior', async () => {
    let applied: DateRange | null = null;
    render(<Harness onRange={(range) => (applied = range)} />);

    await userEvent.click(screen.getByRole('button', { name: /Período/ }));
    expect(screen.getByRole('button', { name: 'Mês atual' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Últimos 12 meses' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(applied).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(screen.getByRole('button', { name: 'Período: 01/09 – 30/09' })).toBeVisible();
  });

  it('o período é compartilhado e começa no mês corrente de São Paulo', () => {
    setTodayOverride('2026-10-24');
    const Reader = () => <p>{JSON.stringify(useFinancePeriod().range)}</p>;
    render(
      <FinancePeriodProvider>
        <Reader />
      </FinancePeriodProvider>,
    );
    expect(screen.getByText('{"from":"2026-10-01","to":"2026-10-31"}')).toBeVisible();
    setTodayOverride(null);
  });
});
