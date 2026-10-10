import type { OverviewResource } from '@patrimonio/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

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
    },
    {
      date: '2026-10-06',
      contributions: '225600.00',
      total: '318904.12',
      result: '93304.12',
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
    ],
    target_sum: { total_pct: '100.00', missing_pp: '0.00', closes: true },
    target_rejected: false,
  },
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
  attention: { total: 0, groups: [] },
};

const ready = (value: OverviewResource): Resource<OverviewResource> => ({
  state: { kind: 'ready', value },
  pending: false,
  reload: () => {},
});

const show = (resource: Resource<OverviewResource>) =>
  render(
    <PreferencesProvider storage={null}>
      <OverviewView
        resource={resource}
        period={DEFAULT_PERIOD}
        onPeriodChange={() => {}}
        today={HOJE}
      />
    </PreferencesProvider>,
  );

describe('quanto eu tenho hoje', () => {
  it('o patrimônio abre a tela, com a data do fechamento ao lado do nome', () => {
    show(ready(overview));

    expect(screen.getByText('R$ 318.904,12')).toBeInTheDocument();
    expect(screen.getByText(/fechamento de 06\/10\/2026/)).toBeInTheDocument();
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

    const tabela = screen.getByRole('table', { name: 'Distribuição por categoria' });

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

describe('o que precisa de mim', () => {
  it('sem pendência o painel não existe: nenhum bloco vazio na tela', () => {
    show(ready(overview));

    expect(screen.queryByText(/Requer atenção/)).not.toBeInTheDocument();
  });

  it('com pendência, cada alerta aparece no grupo da ação que ele pede', () => {
    show(
      ready({
        ...overview,
        attention: {
          total: 1,
          groups: [
            {
              group: 'corrigir',
              count: 1,
              items: [
                {
                  rule_kind: 'price_stale',
                  subject_id: 'a1',
                  portfolio_id: '0191e5a0-0000-7000-8000-00000000c001',
                  payload: { ticker: 'KNRI11', last_price_date: '2026-10-03' },
                  first_seen_at: '2026-10-06T12:00:00.000Z',
                },
              ],
            },
          ],
        },
      }),
    );

    expect(screen.getByText('Requer atenção · 1')).toBeInTheDocument();
    expect(screen.getByText('Corrigir dados · 1')).toBeInTheDocument();
    expect(screen.getByText(/KNRI11/)).toBeInTheDocument();
    // O alerta diz de qual carteira ele é, porque o painel mistura todas.
    expect(screen.getByText('Longo prazo')).toBeInTheDocument();
  });
});

describe('o que a tela faz quando não há número', () => {
  it('carteira sem fechamento convida ao primeiro lançamento, e não mostra zero', () => {
    show(
      ready({
        ...overview,
        reference_date: null,
        totals: { value: null, day: null, month: null },
        series: [],
      }),
    );

    expect(screen.getByText('Nenhum fechamento ainda')).toBeInTheDocument();
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
  });

  it('erro da api não vira "nenhum resultado": a tela diz o que aconteceu', () => {
    show({
      state: { kind: 'error', error: new Error('não foi possível falar com a api') },
      pending: false,
      reload: () => {},
    });

    expect(screen.getByRole('alert')).toHaveTextContent('não foi possível falar com a api');
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
