import axe from 'axe-core';
import type {
  GoalsOverviewResource,
  OverviewResource,
  PerformanceResource,
} from '@patrimonio/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../../finance/components/period_provider.js';
import { monthFlow } from '../../finance/domain/cash_flow.js';
import { setTodayOverride } from '../../finance/lib/clock.js';
import { formatBRL } from '../../finance/lib/format.js';
import {
  createFinanceStore,
  FinanceStoreProvider,
  useFinanceData,
} from '../../finance/store/finance_store.js';
import type { Resource } from '../../lib/use_resource.js';
import { DEFAULT_PERIOD } from '../../lib/period.js';
import { GeralView } from './geral_screen.js';

/**
 * Geral resume Finanças e Investimentos. O que o teste cobra: os painéis que a
 * prancha promete, o número que é o mesmo das outras telas (RN-70) e o erro de
 * investimentos que não vira zero.
 */
const HOJE = '2026-10-24';

const overviewOf = (value: string | null): OverviewResource =>
  ({
    reference_date: value === null ? null : HOJE,
    scope: {
      portfolio_id: null,
      name: 'Todas as carteiras',
      tolerance_pp: '0',
      recalc_status: 'idle',
      inception: '2021-03-15',
    },
    totals: { value, day: null, month: null },
    period: {
      from: '2025-10-25',
      to: HOJE,
      return_pct: '0',
      return_method: 'portfolio_quota',
      contributions: '0.00',
      income: '0.00',
      payouts: '0.00',
    },
    series: [],
    composition: {
      total: value ?? '0.00',
      nodes: [],
      target_sum: { total_pct: '0.00', missing_pp: '0.00', closes: false },
      target_rejected: false,
    },
    by_portfolio: [],
    top_positions: { total_count: 0, rows: [] },
  }) as unknown as OverviewResource;

const ready = <T,>(value: T): Resource<T> => ({
  state: { kind: 'ready', value },
  pending: false,
  reload: () => {},
});

const goalsEmpty = ready({
  reference_date: HOJE,
  portfolios: [],
  totals: { goals: 0 },
} as unknown as GoalsOverviewResource);

const performanceEmpty = ready({
  breakdown: { columns: [], classes: [], portfolios: [] },
} as unknown as PerformanceResource);

const View = ({
  overview,
  onNewEntry = () => {},
}: {
  readonly overview: Resource<OverviewResource>;
  readonly onNewEntry?: () => void;
}) => {
  const data = useFinanceData();
  return (
    <GeralView
      data={data}
      today={HOJE}
      overview={overview}
      performance={performanceEmpty}
      goals={goalsEmpty}
      period={DEFAULT_PERIOD}
      onPeriodChange={() => {}}
      inception={null}
      onNewEntry={onNewEntry}
    />
  );
};

const open = (overview: Resource<OverviewResource>, onNewEntry?: () => void) => {
  setTodayOverride(HOJE);
  const store = createFinanceStore(null);
  const utils = render(
    <MemoryRouter>
      <PreferencesProvider storage={null}>
        <ShortcutProvider>
          <FinanceStoreProvider store={store}>
            <FinancePeriodProvider>
              <View
                overview={overview}
                {...(onNewEntry === undefined ? {} : { onNewEntry })}
              />
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
  return { ...utils, store };
};

describe('Visão geral de Geral (GER)', () => {
  it('abre com a data de hoje e os painéis da prancha', () => {
    open(ready(overviewOf('300000.00')));

    expect(screen.getByText(/hoje, 24\/10\/2026/)).toBeInTheDocument();
    for (const name of [
      'Patrimônio',
      'Fluxo do mês',
      'Evolução do patrimônio',
      'Alocação por classe',
      'Objetivos',
      'Próximos lançamentos',
      'Faturas abertas',
      'Contas',
    ]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('a prancha não tem Saldo previsto nem Carteiras em Tudo', () => {
    open(ready(overviewOf('300000.00')));

    expect(screen.queryByRole('region', { name: 'Saldo previsto' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Carteiras' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Lançar / })).toBeNull();
  });

  it('Livre após faturas vem do servidor, diz quanto falta e que faturas não descontam do patrimônio', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              cards: [],
              upcoming: [],
              open_total: '0.00',
              as_of: HOJE,
              wealth: {
                em_contas: '1462.51',
                abertas: '3000.00',
                fechadas_a_pagar: '1268.37',
                total_devido: '4268.37',
                livre: '0.00',
                falta: '2805.86',
              },
            }),
            { status: 200 },
          ),
      ),
    );
    open(ready(overviewOf('300000.00')));

    const painel = screen.getByRole('region', { name: 'Patrimônio' });
    await waitFor(() =>
      expect(within(painel).getByText('Livre após faturas')).toBeInTheDocument(),
    );
    expect(within(painel).getByRole('status').textContent).toMatch(/2\.805,86/);
    expect(
      within(painel).getByText(/Faturas não descontam do Patrimônio/),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('o patrimônio soma o que está em contas e o que está em carteiras, sem subtrair faturas', () => {
    const { store } = open(ready(overviewOf('300000.00')));
    const flow = monthFlow(store.get(), HOJE);
    const esperado = flow.emContasCents + 30000000;

    const painel = screen.getByRole('region', { name: 'Patrimônio' });
    const tabela = within(painel).getByRole('table', {
      name: 'Composição do patrimônio',
    });

    expect(
      within(within(tabela).getByRole('row', { name: /Investimentos/ })).getAllByText(
        'R$ 300.000,00',
      ),
    ).toBeInTheDocument();
    expect(within(painel).getAllByText(formatBRL(esperado)).length).toBeGreaterThan(0);
  });

  it('investimentos que falham dizem o que houve e não viram patrimônio zero', () => {
    open({
      state: { kind: 'error', error: new Error('api fora do ar') },
      pending: false,
      reload: () => {},
    });

    expect(screen.getByRole('alert')).toHaveTextContent('api fora do ar');
    const painel = screen.getByRole('region', { name: 'Patrimônio' });
    const tabela = within(painel).getByRole('table', {
      name: 'Composição do patrimônio',
    });

    expect(
      within(within(tabela).getByRole('row', { name: /Investimentos/ })).getAllByText('—')
        .length,
    ).toBeGreaterThan(0);
  });

  it('Lançamento abre o novo lançamento', async () => {
    const onNewEntry = vi.fn();
    open(ready(overviewOf('300000.00')), onNewEntry);

    await userEvent.click(screen.getByRole('button', { name: /Lançamento/ }));

    expect(onNewEntry).toHaveBeenCalledTimes(1);
  });

  it('VGR-15 · N abre o novo lançamento, como o botão', async () => {
    const onNewEntry = vi.fn();
    open(ready(overviewOf('300000.00')), onNewEntry);

    await userEvent.keyboard('n');

    expect(onNewEntry).toHaveBeenCalledTimes(1);
  });
});

const aaViolations = async (container: HTMLElement): Promise<readonly string[]> => {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
};

describe('QUA-03 · acessibilidade de Visão geral nos dois temas', () => {
  it.each(['light', 'dark'])('sem violação AA (tema %s)', async (theme) => {
    document.documentElement.dataset['theme'] = theme;
    open(ready(overviewOf('300000.00')));
    expect(await aaViolations(document.body)).toEqual([]);
  });
});
