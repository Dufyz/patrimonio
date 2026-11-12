import type { GoalsOverviewResource } from '@patrimonio/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import type { Resource } from '../lib/use_resource.js';
import { GoalsOverviewView } from './goals_overview.js';

vi.mock('../api/goals.js', () => ({ fetchGoalsOverview: vi.fn() }));

const EMERGENCIA = '0191e5a0-0000-7000-8000-00000000c001';
const INVESTIMENTOS = '0191e5a0-0000-7000-8000-00000000c002';
const CAIXA = '0191e5a0-0000-7000-8000-00000000c003';

type Row = GoalsOverviewResource['portfolios'][number];
type RowGoal = NonNullable<Row['goal']>;

const goal = (overrides: Partial<RowGoal>): RowGoal => ({
  id: '019b0000-0000-7000-8000-0000000000a1',
  name: 'Reserva de emergência',
  target_amount: '180000.00',
  nominal_target_amount: null,
  target_date: '2027-12-31',
  amount_in_today_brl: true,
  return_assumption: 'IPCA+6',
  current_value: '140279.00',
  as_of: '2026-10-22',
  progress_pct: '77.93',
  remaining_brl: '39721.00',
  expected_pct: '74.00',
  status: 'on_track',
  blocked: null,
  months_remaining: 14,
  counted: true,
  excluded_reason: null,
  required_monthly: '1062.00',
  required_share_pct: '13.57',
  current_monthly: '1500.00',
  current_share_pct: '68.18',
  current_arrival_date: '2026-12-22',
  current_months_to_arrival: 2,
  rate: { premise_pct: '10.69', used_pct: '10.69', overridden: false },
  plan: {
    monthly: '1062.00',
    share_pct: '13.57',
    arrival_date: '2027-12-22',
    months_to_arrival: 14,
    reaches_target_date: true,
  },
  ...overrides,
});

const dados: GoalsOverviewResource = {
  reference_date: '2026-10-22',
  portfolios: [
    {
      portfolio_id: EMERGENCIA,
      portfolio_name: 'Emergência',
      goal: goal({}),
    },
    {
      portfolio_id: INVESTIMENTOS,
      portfolio_name: 'Investimentos',
      goal: goal({
        name: 'Independência financeira',
        target_amount: '400000.00',
        target_date: '2030-06-30',
        current_value: '54719.00',
        progress_pct: '13.68',
        remaining_brl: '345281.00',
        expected_pct: '20.00',
        status: 'behind',
        months_remaining: 44,
        required_monthly: '6762.00',
        required_share_pct: '86.43',
        current_monthly: '700.00',
        current_share_pct: '31.82',
        current_arrival_date: '2032-03-22',
        current_months_to_arrival: 65,
        plan: {
          monthly: '6762.00',
          share_pct: '86.43',
          arrival_date: '2030-06-22',
          months_to_arrival: 44,
          reaches_target_date: true,
        },
      }),
    },
    { portfolio_id: CAIXA, portfolio_name: 'Caixa', goal: null },
  ],
  totals: {
    goals: 2,
    counted: 2,
    target_amount: '580000.00',
    current_value: '194998.00',
    remaining_brl: '385002.00',
    progress_pct: '33.62',
    expected_pct: '38.62',
    last_target_date: '2030-06-30',
    required_monthly: '7824.00',
    current_monthly: '2200.00',
    gap_monthly: '5624.00',
    required_schedule: [
      { until: '2027-12-31', monthly: '7824.00' },
      { until: '2030-06-30', monthly: '6762.00' },
    ],
    pace_arrival_date: '2032-03-22',
    pace_months_vs_deadline: 21,
    inflation_pct: '4.50',
  },
  plan: {
    budget: '7824.00',
    distribution: 'proportional',
    cascade: true,
    arrival_date: '2030-06-22',
    months_vs_deadline: 0,
  },
  scenarios: [
    {
      monthly: '2200.00',
      kind: 'current',
      arrival_date: '2032-03-22',
      months_vs_deadline: 21,
      selected: false,
    },
    {
      monthly: '7824.00',
      kind: 'required',
      arrival_date: '2030-06-22',
      months_vs_deadline: 0,
      selected: true,
    },
    {
      monthly: '10000.00',
      kind: 'option',
      arrival_date: '2029-10-22',
      months_vs_deadline: -8,
      selected: false,
    },
  ],
  chart: {
    dates: ['2026-10-22', '2030-06-22', '2032-03-22'],
    pace: ['194998.00', '400000.00', '580000.00'],
    required: ['194998.00', '580000.00', '580000.00'],
    plan: ['194998.00', '580000.00', '580000.00'],
    target_amount: '580000.00',
  },
};

const montar = ({
  value = dados,
  onChange = vi.fn(),
  onOpenPortfolio = vi.fn(),
  rates = {},
  onRateChange = vi.fn(),
  state,
}: {
  readonly value?: GoalsOverviewResource;
  readonly onChange?: ReturnType<typeof vi.fn>;
  readonly onOpenPortfolio?: ReturnType<typeof vi.fn>;
  readonly rates?: Readonly<Record<string, string>>;
  readonly onRateChange?: ReturnType<typeof vi.fn>;
  readonly state?: Resource<GoalsOverviewResource>['state'];
} = {}) =>
  render(
    <PreferencesProvider storage={null}>
      <GoalsOverviewView
        resource={{
          state: state ?? { kind: 'ready', value },
          pending: false,
          reload: vi.fn(),
        }}
        budget={null}
        cascade
        rates={rates}
        onRateChange={onRateChange}
        onChange={onChange}
        onOpenPortfolio={onOpenPortfolio}
      />
    </PreferencesProvider>,
  );

describe('GoalsOverviewView', () => {
  it('responde quanto aportar no total, quanto falta e quando as metas fecham', () => {
    montar();

    const resumo = within(screen.getByRole('region', { name: 'Todos os objetivos' }));

    expect(screen.getByRole('heading', { name: 'Objetivos' })).toBeTruthy();
    expect(resumo.getByText('Abaixo do ritmo')).toBeTruthy();
    expect(resumo.getByText(/R\$\s*7\.824/, { selector: 'span.tabular' })).toBeTruthy();
    expect(resumo.getByText('mar/2032')).toBeTruthy();
    expect(resumo.getByText(/21 meses depois do prazo/)).toBeTruthy();
    expect(resumo.getByText(/faltam/)).toBeTruthy();
  });

  it('avisa que o aporte necessário cai quando a primeira meta fecha', () => {
    montar();

    expect(screen.getByText(/por mês até dez\/2027, depois/)).toBeTruthy();
  });

  it('a tabela traz a fatia de cada carteira no necessário e no que se aporta hoje', () => {
    montar();

    const tabela = screen.getByRole('table', { name: /O objetivo de cada carteira/ });
    const investimentos = within(tabela)
      .getByText('Independência financeira')
      .closest('tr');

    expect(investimentos).not.toBeNull();
    expect(investimentos?.textContent).toMatch(/86%\s*do total/);
    expect(investimentos?.textContent).toMatch(/32%\s*do total/);
    expect(within(tabela).getByText('Total')).toBeTruthy();
  });

  it('põe a carteira mais atrasada primeiro, e a sem objetivo por último', () => {
    montar();

    const linhas = within(
      screen.getByRole('table', { name: /O objetivo de cada carteira/ }),
    )
      .getAllByRole('row')
      .map((linha) => linha.textContent ?? '');

    const corpo = linhas.slice(1, -1);
    expect(corpo[0]).toContain('Investimentos');
    expect(corpo[1]).toContain('Emergência');
    expect(corpo[2]).toContain('Caixa');
  });

  it('a carteira sem objetivo oferece defini-lo dentro dela', async () => {
    const onOpenPortfolio = vi.fn();
    montar({ onOpenPortfolio });

    await userEvent.click(screen.getByRole('button', { name: 'Definir objetivo' }));

    expect(onOpenPortfolio).toHaveBeenCalledWith(CAIXA);
  });

  it('clicar no nome leva ao objetivo da carteira', async () => {
    const onOpenPortfolio = vi.fn();
    montar({ onOpenPortfolio });

    await userEvent.click(
      within(
        screen.getByRole('table', { name: /O objetivo de cada carteira/ }),
      ).getByRole('button', { name: /Investimentos/ }),
    );

    expect(onOpenPortfolio).toHaveBeenCalledWith(INVESTIMENTOS);
  });

  it('escolher um cenário simula com aquele aporte, e o ritmo atual não é escolhível', async () => {
    const onChange = vi.fn();
    montar({ onChange });

    const lista = screen.getByRole('list', { name: /Aporte mensal total/ });
    await userEvent.click(within(lista).getByText(/10\.000/));

    expect(onChange).toHaveBeenCalledWith({ budget: '10000.00' });
    expect(
      (within(lista).getByText('média 12M').closest('button') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('o aporte digitado vai com vírgula normalizada, e valor inválido não simula', async () => {
    const onChange = vi.fn();
    montar({ onChange });

    const campo = screen.getByRole('textbox', { name: /Quanto posso aportar/ });
    const simular = screen.getByRole('button', { name: 'Simular' }) as HTMLButtonElement;

    expect(simular.disabled).toBe(true);

    await userEvent.type(campo, 'abc');
    expect(screen.getByRole('alert').textContent).toMatch(/maior que zero/);
    expect(simular.disabled).toBe(true);

    await userEvent.clear(campo);
    await userEvent.type(campo, '8.500,50');
    await userEvent.click(simular);

    expect(onChange).toHaveBeenCalledWith({ budget: '8500.50' });
  });

  it('liga e desliga a cascata', async () => {
    const onChange = vi.fn();
    montar({ onChange });

    await userEvent.click(
      screen.getByRole('checkbox', { name: /Reaproveitar o aporte de metas concluídas/ }),
    );
    expect(onChange).toHaveBeenCalledWith({ cascade: false });
  });

  it('meta fora da soma continua na tabela, com o motivo', () => {
    const nominal = goal({
      counted: false,
      excluded_reason: 'nominal',
      required_monthly: null,
      required_share_pct: null,
      current_share_pct: null,
      plan: null,
    });

    montar({
      value: {
        ...dados,
        portfolios: [
          dados.portfolios[1] as Row,
          { portfolio_id: EMERGENCIA, portfolio_name: 'Emergência', goal: nominal },
        ],
        totals: { ...dados.totals, counted: 1 },
      },
    });

    expect(
      screen.getByText(
        /Meta em reais da data alvo, sem IPCA para converter: fora da soma/,
      ),
    ).toBeTruthy();
  });

  it('meta nominal convertida entra na soma e mostra a meta original e o IPCA usado', () => {
    const convertida = goal({
      name: 'Independência financeira',
      target_amount: '340000.00',
      nominal_target_amount: '400000.00',
      amount_in_today_brl: false,
    });

    montar({
      value: {
        ...dados,
        portfolios: [
          {
            portfolio_id: INVESTIMENTOS,
            portfolio_name: 'Investimentos',
            goal: convertida,
          },
        ],
      },
    });

    expect(screen.getByTitle(/convertidas pelo IPCA 12M/)).toBeTruthy();
    expect(
      within(
        screen.getByRole('table', { name: /O objetivo de cada carteira/ }),
      ).getAllByRole('row')[1]?.textContent,
    ).toMatch(/meta de R\$\s*400\.000/);
  });

  it('sem nenhum objetivo explica onde defini-los', () => {
    montar({
      value: {
        ...dados,
        portfolios: [{ portfolio_id: CAIXA, portfolio_name: 'Caixa', goal: null }],
        totals: { ...dados.totals, goals: 0, counted: 0 },
        scenarios: [],
        chart: null,
      },
    });

    expect(screen.getByText('Nenhum objetivo nas carteiras')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('quando a leitura falha, diz o motivo e deixa tentar de novo', () => {
    montar({ state: { kind: 'error', error: new Error('sem rede') } });

    expect(screen.getByRole('alert').textContent).toMatch(/sem rede/);
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  it('carregando, anuncia o carregamento', () => {
    montar({ state: { kind: 'loading' } });

    expect(screen.getByText('Carregando os objetivos')).toBeTruthy();
  });
});
