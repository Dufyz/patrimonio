import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Money, Percent } from './number.js';
import { OverviewHeader } from './overview_header.js';
import { KeepPrevious } from './pending.js';
import { PreferencesProvider } from './preferences.js';

const header = (props: Partial<React.ComponentProps<typeof OverviewHeader>> = {}) =>
  render(
    <PreferencesProvider storage={null}>
      <OverviewHeader
        label="Patrimônio · todas as carteiras"
        principal="318904.12"
        change={{ amount: '1049.20', ratio: '0.0033', periodLabel: 'em outubro' }}
        metrics={[
          { label: 'Rent. 12M', value: <Percent value="0.1592" signed /> },
          { label: 'Aportes 12M', value: <Money value="25600" /> },
        ]}
        chart={<div>gráfico principal da tela</div>}
        {...props}
      />
    </PreferencesProvider>,
  );

describe('cabeçalho de visão geral', () => {
  it('o número que responde à pergunta da tela vem primeiro', () => {
    header();
    const principal = screen.getByText(/318\.904,12/u);
    expect(principal).toBeVisible();
    expect(principal).toHaveClass('text-principal');
  });

  it('a variação do período acompanha o número principal', () => {
    header();
    expect(screen.getByText(/1\.049,20/u)).toBeVisible();
    expect(screen.getByText(/0,33%/u)).toBeVisible();
    expect(screen.getByText('em outubro')).toBeVisible();
  });

  it('as métricas de apoio param em quatro', () => {
    header({
      metrics: [
        { label: 'Uma', value: '1' },
        { label: 'Duas', value: '2' },
        { label: 'Três', value: '3' },
        { label: 'Quatro', value: '4' },
        { label: 'Cinco', value: '5' },
      ],
    });
    expect(screen.getByText('Quatro')).toBeVisible();
    expect(screen.queryByText('Cinco')).not.toBeInTheDocument();
  });

  it('a ressalva de dado desatualizado fica junto do número principal', () => {
    header({ caveat: 'dois preços de 03/10' });
    expect(screen.getByText('dois preços de 03/10')).toBeVisible();
  });

  it('carteira sem lançamento troca o gráfico pelo convite, na mesma altura', () => {
    header({
      principal: '0',
      change: undefined,
      metrics: [],
      chart: <button type="button">Lançar nesta carteira</button>,
    });

    expect(screen.getByText(/0,00/u)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Lançar nesta carteira' })).toBeVisible();
  });
});

describe('troca de período sem piscar', () => {
  it('o conteúdo anterior fica na tela até o novo chegar', () => {
    const { rerender } = render(
      <KeepPrevious pending={false}>
        <p>12 meses</p>
      </KeepPrevious>,
    );
    expect(screen.getByText('12 meses')).toBeVisible();

    rerender(
      <KeepPrevious pending>
        <p>24 meses</p>
      </KeepPrevious>,
    );

    expect(screen.getByText('12 meses')).toBeVisible();
    expect(screen.queryByText('24 meses')).not.toBeInTheDocument();

    rerender(
      <KeepPrevious pending={false}>
        <p>24 meses</p>
      </KeepPrevious>,
    );
    expect(screen.getByText('24 meses')).toBeVisible();
  });

  it('enquanto espera, a tela se anuncia ocupada sem esvaziar', () => {
    render(
      <KeepPrevious pending>
        <p>12 meses</p>
      </KeepPrevious>,
    );
    expect(screen.getByText('12 meses').parentElement).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });
});
