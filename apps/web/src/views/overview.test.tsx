import type { OverviewResource, PerformanceResource } from '@patrimonio/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import { DEFAULT_PERIOD } from '../lib/period.js';
import type { Resource } from '../lib/use_resource.js';
import { OverviewView } from './overview.js';

/**
 * O que a tela promete e o teste cobra: a ordem das perguntas, o bloco que
 * some quando não há pendência, o erro que não vira tela vazia e o número que
 * nunca aparece como zero quando ele não existe.
 */
const HOJE = '2026-10-06';

const overview: OverviewResource = {
  reference_date: '2026-10-06',
  scope: {
    portfolio_id: '0191e5a0-0000-7000-8000-00000000c001',
    name: 'Longo prazo',
    tolerance_pp: '3',
    recalc_status: 'idle',
    inception: '2021-03-15',
  },
  totals: {
    value: '318904.12',
    day: { amount: '312.40', ratio: '0.10' },
    month: { amount: '1049.20', ratio: '0.33' },
  },
  period: {
    from: '2025-10-07',
    to: '2026-10-06',
    return_pct: '15.92',
    return_method: 'portfolio_quota',
    contributions: '25600.00',
    income: '40949.46',
    payouts: '3120.00',
  },
  series: [
    {
      date: '2025-10-07',
      contributions: '200000.00',
      total: '250000.00',
      result: '50000.00',
      payouts: '0.00',
      with_payouts: '250000.00',
    },
    {
      date: '2026-10-06',
      contributions: '225600.00',
      total: '318904.12',
      result: '93304.12',
      payouts: '3120.00',
      with_payouts: '322024.12',
    },
  ],
  composition: {
    total: '318904.12',
    nodes: [
      {
        id: 'cat-acoes',
        name: 'Ações',
        color_token: 'class.acoes',
        level: 'category',
        value: '112572.15',
        current_pct: '35.30',
        target_pct: '35.00',
        deviation_pp: '0.30',
        over_tolerance: false,
        amount_to_move: '-956.71',
        target_value: '111615.44',
        children: [],
      },
      {
        id: 'cat-fiis',
        name: 'FIIs',
        color_token: 'class.fiis',
        level: 'category',
        value: '76855.89',
        current_pct: '24.10',
        target_pct: '25.00',
        deviation_pp: '-0.90',
        over_tolerance: false,
        amount_to_move: '2870.14',
        target_value: '79726.03',
        children: [],
      },
      {
        id: 'cat-cripto',
        name: 'Cripto',
        color_token: 'class.outros',
        level: 'category',
        value: '1000.00',
        current_pct: '0.30',
        target_pct: null,
        deviation_pp: null,
        over_tolerance: false,
        amount_to_move: null,
        target_value: null,
        children: [],
      },
    ],
    target_sum: { total_pct: '100.00', missing_pp: '0.00', closes: true },
    target_rejected: false,
  },
  by_portfolio: [],
  top_positions: {
    total_count: 28,
    rows: [
      {
        asset_id: '0191e5a0-0000-7000-8000-00000000c010',
        ticker: 'ITUB4',
        name: 'Itaú Unibanco PN',
        b3_type: 'stock',
        color_token: 'class.acoes',
        value: '18420.00',
        weight_pct: '5.80',
        price_source_kind: 'fresh',
      },
    ],
  },
};

const CDI = 'CDI';
const IBOV = 'IBOV';
const LONGO = '0191e5a0-0000-7000-8000-00000000c001';

const performanceData: PerformanceResource = {
  reference_date: '2026-09-30',
  scope: {
    portfolio_id: LONGO,
    name: 'Longo prazo',
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
    gaps: [],
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
        benchmark: null,
        name: 'Longo prazo',
        values: ['0.98', '15.92', null, '102.96'],
      },
      {
        kind: 'benchmark',
        benchmark: CDI,
        name: 'CDI',
        values: ['1.14', '14.52', null, '84.90'],
      },
      {
        kind: 'difference',
        benchmark: null,
        name: 'Diferença',
        values: ['-0.16', '1.40', null, '18.06'],
      },
    ],
  },
  breakdown: {
    columns: [
      { key: 'month', base_date: '2026-08-31' },
      { key: 'ytd', base_date: '2025-12-31' },
      { key: '12m', base_date: '2025-09-30' },
      { key: 'inception', base_date: '2021-03-15' },
    ],
    classes: [
      {
        category_id: 'cat-acoes',
        name: 'Ações',
        color_token: 'class.acoes',
        value: '112572.15',
        weight_pct: '35.30',
        returns: ['1.20', '9.00', '12.00', '80.00'],
      },
      {
        category_id: 'cat-cripto',
        name: 'Cripto',
        color_token: 'class.outros',
        value: '1000.00',
        weight_pct: '0.30',
        returns: [null, null, null, null],
      },
    ],
    portfolios: [],
  },
};

const readyPerf = (value: PerformanceResource): Resource<PerformanceResource> => ({
  state: { kind: 'ready', value },
  pending: false,
  reload: () => {},
});

const ready = (value: OverviewResource): Resource<OverviewResource> => ({
  state: { kind: 'ready', value },
  pending: false,
  reload: () => {},
});

const consolidated: OverviewResource = {
  ...overview,
  scope: {
    ...overview.scope,
    portfolio_id: null,
    name: 'Todas as carteiras',
    tolerance_pp: '0',
  },
  by_portfolio: [
    { portfolio_id: LONGO, name: 'Longo prazo', value: '318904.12', weight_pct: '80.00' },
    {
      portfolio_id: '0191e5a0-0000-7000-8000-00000000c002',
      name: 'Reserva',
      value: '79726.03',
      weight_pct: '20.00',
    },
  ],
};

const consolidatedPerformance: PerformanceResource = {
  ...performanceData,
  scope: { ...performanceData.scope, portfolio_id: null, name: 'Todas as carteiras' },
  breakdown: {
    ...performanceData.breakdown,
    portfolios: [
      {
        portfolio_id: LONGO,
        name: 'Longo prazo',
        value: '318904.12',
        weight_pct: '80.00',
        returns: ['0.98', '7.10', '15.92', '102.96'],
      },
      {
        portfolio_id: '0191e5a0-0000-7000-8000-00000000c002',
        name: 'Reserva',
        value: '79726.03',
        weight_pct: '20.00',
        returns: ['0.80', '9.50', null, '9.50'],
      },
    ],
  },
};

const showConsolidated = (opened: string[] = []) =>
  render(
    <PreferencesProvider storage={null}>
      <OverviewView
        resource={ready(consolidated)}
        performance={readyPerf(consolidatedPerformance)}
        extraIds={[]}
        onExtraIdsChange={() => {}}
        period={DEFAULT_PERIOD}
        onPeriodChange={() => {}}
        today={HOJE}
        onOpenPortfolio={(id) => opened.push(id)}
      />
    </PreferencesProvider>,
  );

const show = (resource: Resource<OverviewResource>) =>
  render(
    <PreferencesProvider storage={null}>
      <OverviewView
        resource={resource}
        performance={readyPerf(performanceData)}
        extraIds={[]}
        onExtraIdsChange={() => {}}
        period={DEFAULT_PERIOD}
        onPeriodChange={() => {}}
        today={HOJE}
      />
    </PreferencesProvider>,
  );

describe('todas as carteiras', () => {
  it('diz de quê é o número e mostra quanto cada carteira pesa', () => {
    showConsolidated();

    expect(screen.getByText(/Patrimônio · todas as carteiras/i)).toBeInTheDocument();

    const tabela = screen.getByRole('table', {
      name: 'Valor, peso e retorno de cada carteira',
    });

    expect(within(tabela).getByText('Longo prazo')).toBeInTheDocument();
    expect(within(tabela).getByText('80,0%')).toBeInTheDocument();
    expect(within(tabela).getByText('20,0%')).toBeInTheDocument();
  });

  it('mostra o retorno de cada carteira pela cota dela, com traço onde não há base', () => {
    showConsolidated();

    const tabela = screen.getByRole('table', {
      name: 'Valor, peso e retorno de cada carteira',
    });
    const reserva = within(tabela).getByRole('row', { name: /Reserva/ });

    expect(within(reserva).getByText('0,80%')).toBeInTheDocument();
    expect(within(reserva).getAllByText('9,50%')).toHaveLength(2);
    expect(within(reserva).getByText('—')).toBeInTheDocument();
  });

  it('mantém o retorno contra benchmark e o retorno por classe, sem o alvo', () => {
    showConsolidated();

    expect(screen.getByText(/Retorno × benchmarks/)).toBeInTheDocument();

    const classes = screen.getByRole('table', {
      name: 'Distribuição e retorno por classe de ativo',
    });

    expect(within(classes).getByText('12,00%')).toBeInTheDocument();
    expect(screen.queryByText('vs alvo')).not.toBeInTheDocument();
    expect(screen.getByText(/O alvo é declarado por carteira/)).toBeInTheDocument();
  });

  it('abre a visão geral da carteira escolhida', async () => {
    const opened: string[] = [];
    showConsolidated(opened);

    await userEvent.click(screen.getByRole('button', { name: 'Reserva' }));

    expect(opened).toEqual(['0191e5a0-0000-7000-8000-00000000c002']);
  });
});

describe('quanto eu tenho hoje', () => {
  it('o patrimônio abre a tela, com a data da consolidação ao lado do nome', () => {
    show(ready(overview));

    expect(screen.getByText('R$ 318.904,12')).toBeInTheDocument();
    expect(screen.getByText(/consolidação de 06\/10\/2026/)).toBeInTheDocument();
  });

  it('a variação do mês aparece em dinheiro e em percentual, com sinal', () => {
    show(ready(overview));

    expect(screen.getByText('R$ 1.049,20')).toBeInTheDocument();
    expect(screen.getByText('0,33%')).toBeInTheDocument();
  });

  it('o peso de cada posição é o que a api calculou, sem conta na tela', () => {
    show(ready(overview));

    const tabela = screen.getByRole('table', { name: 'Maiores posições' });

    expect(within(tabela).getByText('5,8%')).toBeInTheDocument();
  });

  it('o desvio contra o alvo sai em pontos percentuais', () => {
    show(ready(overview));

    const tabela = screen.getByRole('table', {
      name: 'Distribuição e retorno por classe de ativo',
    });

    expect(within(tabela).getByText('0,3 pp')).toBeInTheDocument();
    expect(within(tabela).getByText('0,9 pp')).toBeInTheDocument();
  });

  it('dentro da tolerância, a tela diz isso em uma linha', () => {
    show(ready(overview));

    expect(
      screen.getByText('Todas as classes dentro da tolerância de 3 pp.'),
    ).toBeInTheDocument();
  });
});

describe('o que a tela faz quando não há número', () => {
  it('carteira sem consolidação convida ao primeiro lançamento, e não mostra zero', () => {
    show(
      ready({
        ...overview,
        reference_date: null,
        totals: { value: null, day: null, month: null },
        series: [],
      }),
    );

    expect(screen.getByText('Carteira ainda não consolidada')).toBeInTheDocument();
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
  });

  it('erro da api não vira "nenhum resultado": a tela diz o que aconteceu', () => {
    show({
      state: { kind: 'error', error: new Error('não foi possível falar com a api') },
      pending: false,
      reload: () => {},
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'não foi possível falar com a api',
    );
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('recálculo em andamento não é patrimônio zero: o número fica, com a ressalva', () => {
    show(
      ready({
        ...overview,
        scope: { ...overview.scope, recalc_status: 'running' },
      }),
    );

    expect(screen.getByText('R$ 318.904,12')).toBeInTheDocument();
    expect(screen.getByText(/recalculando/)).toBeInTheDocument();
  });
});

describe('o atalho para a página do ativo', () => {
  it('a maior posição abre o ativo pelo mesmo apelido que Posições usa', async () => {
    const opened: string[] = [];

    render(
      <PreferencesProvider storage={null}>
        <OverviewView
          resource={ready(overview)}
          performance={readyPerf(performanceData)}
          extraIds={[]}
          onExtraIdsChange={() => {}}
          period={DEFAULT_PERIOD}
          onPeriodChange={() => {}}
          today={HOJE}
          onOpenAsset={(slug) => opened.push(slug)}
        />
      </PreferencesProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'ITUB4' }));

    expect(opened).toEqual(['itub4']);
  });

  it('título de banco se chama pelo nome, não por um código que ninguém lê', () => {
    show(
      ready({
        ...overview,
        top_positions: {
          total_count: 1,
          rows: [
            {
              asset_id: '0191e5a0-0000-7000-8000-00000000c011',
              ticker: 'CDB-BANCOC-20280614',
              name: 'CDB Banco C 2028',
              b3_type: null,
              color_token: 'class.rf-pos',
              value: '21408.33',
              weight_pct: '6.70',
              price_source_kind: 'fresh',
            },
          ],
        },
      }),
    );

    expect(screen.getByText('CDB Banco C 2028')).toBeInTheDocument();
  });
});

describe('por classe', () => {
  it('classe sem base no período: traço, e não 0,00%', () => {
    show(ready(overview));

    const tabela = screen.getByRole('table', {
      name: 'Distribuição e retorno por classe de ativo',
    });
    const caixa = within(tabela).getByRole('row', { name: /Cripto/ });

    expect(within(caixa).getAllByText('—')).toHaveLength(4);
  });
});

describe('benchmarks no gráfico de retorno', () => {
  const showRetorno = (
    onExtraIdsChange: (ids: readonly string[]) => void,
    extraIds: readonly string[] = [],
    perf = performanceData,
  ) =>
    render(
      <PreferencesProvider storage={null}>
        <OverviewView
          resource={ready(overview)}
          performance={readyPerf(perf)}
          period={DEFAULT_PERIOD}
          onPeriodChange={() => {}}
          extraIds={extraIds}
          onExtraIdsChange={onExtraIdsChange}
          today={HOJE}
        />
      </PreferencesProvider>,
    );

  it('escolher um benchmark devolve a lista nova a quem a guarda', async () => {
    const onExtraIdsChange = vi.fn();
    showRetorno(onExtraIdsChange);

    await userEvent.click(screen.getByRole('button', { name: /Benchmark/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ibovespa' }));

    expect(onExtraIdsChange).toHaveBeenCalledWith([IBOV]);
  });

  it('série que não cobre o período é dita, e não desenhada curta', () => {
    showRetorno(() => {}, [], {
      ...performanceData,
      benchmarks: {
        ...performanceData.benchmarks,
        gaps: [{ id: IBOV, name: 'Ibovespa', available_from: null }],
      },
    });

    expect(screen.getByText(/Ibovespa \(nenhum dado coletado\)/)).toBeInTheDocument();
  });
});
