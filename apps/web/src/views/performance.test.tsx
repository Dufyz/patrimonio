import type { PerformanceResource } from '@patrimonio/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import type { Resource } from '../lib/use_resource.js';
import { PERFORMANCE_DEFAULT_PERIOD, PerformanceView } from './performance.js';

/**
 * O que a tela promete e o teste cobra: retorno ausente é traço e não zero,
 * a diferença é em pontos, o método está escrito na tela e a escolha de
 * benchmark volta para quem a guarda.
 */
const CDI = '019b0000-0000-7000-8000-000000000001';
const IBOV = '019b0000-0000-7000-8000-000000000004';
const LONGO = '0191e5a0-0000-7000-8000-00000000c001';
const RESERVA = '0191e5a0-0000-7000-8000-00000000c002';

const year = {
  year: 2026,
  months: ['0.77', '1.34', '1.72', null, null, null, null, null, null, null, null, null],
  total_pct: '11.58',
  benchmark_pct: '7.10',
  difference_pp: '4.48',
  partial: true,
};

const performance: PerformanceResource = {
  reference_date: '2026-09-30',
  scope: {
    portfolio_id: LONGO,
    name: 'Longo prazo',
    purpose: null,
    recalc_status: 'idle',
    inception: '2021-03-15',
  },
  method: {
    portfolio: 'portfolio_quota',
    class: 'modified_dietz',
    benchmark: 'compound_daily_factors',
    annualized: false,
  },
  benchmarks: {
    available: [
      { id: CDI, name: 'CDI', kind: 'index' },
      { id: IBOV, name: 'Ibovespa', kind: 'index' },
    ],
    selected: [{ id: CDI, name: 'CDI', kind: 'index' }],
    primary_id: CDI,
  },
  chart: {
    base_date: '2024-09-30',
    dates: ['2024-09-30', '2026-09-30'],
    portfolio: ['0.00', '30.10'],
    benchmarks: [{ id: CDI, values: ['0.00', '29.29'] }],
  },
  windows: {
    columns: [
      { key: 'month', base_date: '2026-08-31' },
      { key: '12m', base_date: '2025-09-30' },
      { key: '24m', base_date: null },
      { key: 'inception', base_date: '2021-03-15' },
    ],
    rows: [
      {
        kind: 'portfolio',
        benchmark_id: null,
        name: 'Longo prazo',
        values: ['0.98', '15.92', null, '102.96'],
      },
      {
        kind: 'benchmark',
        benchmark_id: CDI,
        name: 'CDI',
        values: ['1.14', '14.52', null, '84.90'],
      },
      {
        kind: 'difference',
        benchmark_id: null,
        name: 'Diferença',
        values: ['-0.16', '1.40', null, '18.06'],
      },
    ],
  },
  monthly: { benchmark_name: 'CDI', years: [year] },
  decomposition: {
    benchmark_name: 'CDI',
    rows: [
      {
        month: '2026-09',
        opening_value: '303480.81',
        net_flow: '7400.00',
        income: '2974.11',
        payouts: '1283.40',
        closing_value: '313854.92',
        return_pct: '0.98',
        benchmark_pct: '1.14',
        difference_pp: '-0.16',
      },
    ],
    total: {
      months: 12,
      from: '2025-10-01',
      to: '2026-09-30',
      opening_value: '247305.46',
      net_flow: '25600.00',
      income: '40949.46',
      payouts: '14218.40',
      closing_value: '313854.92',
      return_pct: '15.92',
      benchmark_pct: '14.52',
      difference_pp: '1.40',
    },
  },
  breakdown: {
    columns: [
      { key: 'month', base_date: '2026-08-31' },
      { key: 'ytd', base_date: '2025-12-31' },
      { key: '12m', base_date: '2025-09-30' },
      { key: 'inception', base_date: '2021-03-15' },
    ],
    portfolios: [
      {
        portfolio_id: LONGO,
        name: 'Longo prazo',
        value: '313854.92',
        weight_pct: '72.20',
        selected: true,
        returns: ['0.98', '11.58', '15.92', '102.96'],
      },
      {
        portfolio_id: RESERVA,
        name: 'Reserva',
        value: '5000.00',
        weight_pct: '27.80',
        selected: false,
        returns: [null, null, null, null],
      },
    ],
    classes: [
      {
        category_id: 'c1',
        name: 'Ações',
        color_token: 'class.acoes',
        value: '112572.15',
        weight_pct: '35.30',
        is_cash: false,
        returns: ['1.20', '9.00', '12.00', '80.00'],
      },
      {
        category_id: 'c2',
        name: 'Caixa',
        color_token: 'class.caixa',
        value: '1000.00',
        weight_pct: '0.30',
        is_cash: true,
        returns: ['0.00', '0.00', '0.00', '0.00'],
      },
    ],
  },
};

const ready = (value: PerformanceResource): Resource<PerformanceResource> => ({
  state: { kind: 'ready', value },
  pending: false,
  reload: () => {},
});

const show = (
  resource: Resource<PerformanceResource>,
  options: {
    readonly extraIds?: readonly string[];
    readonly onExtraIdsChange?: (ids: readonly string[]) => void;
  } = {},
) =>
  render(
    <PreferencesProvider storage={null}>
      <PerformanceView
        resource={resource}
        period={PERFORMANCE_DEFAULT_PERIOD}
        onPeriodChange={() => {}}
        today="2026-10-09"
        extraIds={options.extraIds ?? []}
        onExtraIdsChange={options.onExtraIdsChange ?? (() => {})}
      />
    </PreferencesProvider>,
  );

describe('retorno por janela', () => {
  it('cada janela tem o rótulo da data que a ancora', () => {
    show(ready(performance));

    const tabela = screen.getByRole('table', { name: 'Retorno por janela' });

    expect(within(tabela).getByText('SET/26')).toBeInTheDocument();
    expect(within(tabela).getByText('Início · MAR/21')).toBeInTheDocument();
  });

  it('janela maior que o histórico é traço, nunca zero', () => {
    show(ready(performance));

    const tabela = screen.getByRole('table', { name: 'Retorno por janela' });
    const carteira = within(tabela).getByRole('row', { name: /Longo prazo/ });

    expect(within(carteira).getByText('—')).toBeInTheDocument();
    expect(within(carteira).queryByText('0,00%')).not.toBeInTheDocument();
  });

  it('a diferença contra o benchmark sai em pontos percentuais', () => {
    show(ready(performance));

    const tabela = screen.getByRole('table', { name: 'Retorno por janela' });
    const diferenca = within(tabela).getByRole('row', { name: /Diferença/ });

    expect(within(diferenca).getByText(/1,40 pp/)).toBeInTheDocument();
    expect(within(diferenca).getByText(/0,16 pp/)).toBeInTheDocument();
  });
});

describe('benchmarks na tela', () => {
  it('diz qual é o principal e oferece os que faltam', async () => {
    show(ready(performance));

    expect(screen.getByText('benchmark principal: CDI')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Benchmark/ }));

    expect(screen.getByRole('menuitem', { name: 'Ibovespa' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'CDI' })).not.toBeInTheDocument();
  });

  it('escolher um benchmark devolve a lista nova a quem a guarda', async () => {
    const onExtraIdsChange = vi.fn();
    show(ready(performance), { onExtraIdsChange });

    await userEvent.click(screen.getByRole('button', { name: /Benchmark/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ibovespa' }));

    expect(onExtraIdsChange).toHaveBeenCalledWith([IBOV]);
  });

  it('remover um benchmark extra tira só ele', async () => {
    const onExtraIdsChange = vi.fn();
    show(
      ready({
        ...performance,
        benchmarks: {
          ...performance.benchmarks,
          selected: [
            { id: CDI, name: 'CDI', kind: 'index' },
            { id: IBOV, name: 'Ibovespa', kind: 'index' },
          ],
        },
      }),
      { extraIds: [IBOV], onExtraIdsChange },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remover filtro' }));

    expect(onExtraIdsChange).toHaveBeenCalledWith([]);
  });

  it('benchmark sem dado no período é avisado, e não desenhado em zero', () => {
    show(ready({ ...performance, chart: { ...performance.chart, benchmarks: [] } }));

    expect(screen.getByText(/Sem dado de índice no período: CDI/)).toBeInTheDocument();
  });
});

describe('retornos mensais', () => {
  it('a grade traz o ano, o total e as colunas contra o benchmark', () => {
    show(ready(performance));

    const grade = screen.getByRole('table', {
      name: 'Retorno mensal da carteira por ano',
    });

    expect(within(grade).getByText('2026')).toBeInTheDocument();
    const ano = within(grade).getByRole('row', { name: /2026/ });

    // O sinal é uma peça à parte do número: o texto da célula é que é conferido.
    expect(ano.textContent).toContain('+11,58%');
    expect(ano.textContent).toContain('4,48 pp');
    expect(within(grade).getByRole('columnheader', { name: 'CDI' })).toBeInTheDocument();
  });
});

describe('de onde veio cada mês', () => {
  it('o mês mais recente vem primeiro e o total fecha a tabela', () => {
    show(ready(performance));

    const tabela = screen.getByRole('table', { name: 'Decomposição mensal do saldo' });
    const linhas = within(tabela).getAllByRole('row');

    expect(within(linhas[1]!).getByText('set/26')).toBeInTheDocument();
    expect(within(linhas[linhas.length - 1]!).getByText('12 meses')).toBeInTheDocument();
  });

  it('aporte e rendimento são colunas separadas, com o valor da api', () => {
    show(ready(performance));

    const tabela = screen.getByRole('table', { name: 'Decomposição mensal do saldo' });

    expect(within(tabela).getAllByText('7.400,00').length).toBeGreaterThan(0);
    expect(within(tabela).getAllByText(/2\.974,11/).length).toBeGreaterThan(0);
  });
});

describe('por carteira e por classe', () => {
  it('a carteira da tela fica marcada; a sem comparação mostra traço', () => {
    show(ready(performance));

    const tabela = screen.getByRole('table', { name: 'Retorno por carteira' });
    const longo = within(tabela).getByRole('row', { name: /Longo prazo/ });
    const reserva = within(tabela).getByRole('row', { name: /Reserva/ });

    expect(longo).toHaveAttribute('aria-current', 'true');
    expect(within(reserva).getAllByText('—')).toHaveLength(4);
  });

  it('o caixa não tem retorno: traço, e não 0,00%', () => {
    show(ready(performance));

    const tabela = screen.getByRole('table', { name: 'Retorno por classe de ativo' });
    const caixa = within(tabela).getByRole('row', { name: /Caixa/ });

    expect(within(caixa).getAllByText('—')).toHaveLength(4);
  });
});

describe('o método e os estados', () => {
  it('o método está escrito na tela', () => {
    show(ready(performance));

    expect(screen.getByText('Como estes números são calculados')).toBeInTheDocument();
    const metodo = screen
      .getByText('Como estes números são calculados')
      .closest('section') as HTMLElement;

    expect(within(metodo).getByText(/Dietz modificado/)).toBeInTheDocument();
    expect(within(metodo).getByText(/nada é anualizado/)).toBeInTheDocument();
  });

  it('sem fechamento, a tela diz que não há história — e não mostra tabelas vazias', () => {
    show(ready({ ...performance, reference_date: null }));

    expect(screen.getByText('Nenhum fechamento ainda')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('erro não vira tela vazia', async () => {
    const reload = vi.fn();
    render(
      <PreferencesProvider storage={null}>
        <PerformanceView
          resource={{
            state: { kind: 'error', error: new Error('api fora') },
            pending: false,
            reload,
          }}
          period={PERFORMANCE_DEFAULT_PERIOD}
          onPeriodChange={() => {}}
          today="2026-10-09"
          extraIds={[]}
          onExtraIdsChange={() => {}}
        />
      </PreferencesProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('api fora');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(reload).toHaveBeenCalled();
  });

  it('carregando, avisa que está ocupada', () => {
    render(
      <PreferencesProvider storage={null}>
        <PerformanceView
          resource={{ state: { kind: 'loading' }, pending: true, reload: () => {} }}
          period={PERFORMANCE_DEFAULT_PERIOD}
          onPeriodChange={() => {}}
          today="2026-10-09"
          extraIds={[]}
          onExtraIdsChange={() => {}}
        />
      </PreferencesProvider>,
    );

    expect(screen.getByText(/Carregando/)).toHaveAttribute('aria-busy', 'true');
  });
});
