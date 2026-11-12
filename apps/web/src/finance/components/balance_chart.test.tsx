import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { dailyBalances } from '../domain/accounts.js';
import { SEED_REFERENCE_DATE, seedData } from '../domain/seed.js';
import { BalanceChart } from './balance_chart.js';

const points = dailyBalances(
  seedData(),
  'itau-corrente',
  { from: '2026-10-01', to: '2026-10-31' },
  SEED_REFERENCE_DATE,
);

const open = () =>
  render(
    <PreferencesProvider>
      <BalanceChart points={points} today={SEED_REFERENCE_DATE} name="Itaú Corrente" />
    </PreferencesProvider>,
  );

describe('Saldo dia a dia (FIN-406)', () => {
  it('descreve o gráfico para leitor de tela', () => {
    open();
    expect(
      screen.getByRole('img', {
        name: 'Saldo dia a dia de Itaú Corrente: de R$ 2.133,55 em 01/10 a R$ 3.112,80 em 24/10',
      }),
    ).toBeInTheDocument();
  });

  it('ponto inicial escuro e ponto final azul', () => {
    open();
    expect(screen.getByTestId('balance-start').getAttribute('class')).toContain(
      'fill-ink',
    );
    expect(screen.getByTestId('balance-end').getAttribute('class')).toContain(
      'fill-accent',
    );
  });

  it('datas a cada quatro dias, e a última sempre aparece', () => {
    const { container } = open();
    const labels = [...container.querySelectorAll('svg text')]
      .map((t) => t.textContent ?? '')
      .filter((t) => /^\d\d\/\d\d$/.test(t));
    expect(labels).toEqual([
      '01/10',
      '05/10',
      '09/10',
      '13/10',
      '17/10',
      '21/10',
      '24/10',
    ]);
  });

  it('a dica mostra data e saldo ao passar o mouse', () => {
    open();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.mouseMove(screen.getByTestId('balance-hit'), { clientX: 0 });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('01/10');
    expect(tip.textContent).toContain('R$ 2.133,55');
    fireEvent.mouseLeave(screen.getByTestId('balance-hit'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('sem pontos não desenha nada', () => {
    const { container } = render(
      <PreferencesProvider>
        <BalanceChart points={[]} today={SEED_REFERENCE_DATE} name="X" />
      </PreferencesProvider>,
    );
    expect(container.querySelector('svg')).toBeNull();
  });
});
