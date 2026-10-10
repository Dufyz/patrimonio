import type { GoalResource, GoalsResource } from '@patrimonio/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import type { Resource } from '../lib/use_resource.js';
import { GoalsView } from './goals.js';

const LONGO = '0191e5a0-0000-7000-8000-00000000c001';
const META = '019b0000-0000-7000-8000-0000000000a1';

const goal: GoalResource = {
  id: META,
  name: 'Independência financeira',
  target_amount: '1500000.00',
  target_date: '2040-01-01',
  amount_in_today_brl: true,
  created_on: '2025-01-01',
  portfolios: {
    all: false,
    items: [{ id: LONGO, name: 'Longo prazo', value: '318904.00' }],
  },
  current_value: '318904.00',
  as_of: '2026-09-30',
  progress_pct: '21.26',
  remaining_brl: '1181096.00',
  surplus_brl: null,
  expected_pct: '23.50',
  status: 'behind',
  months_remaining: 160,
  blocked: null,
  rate: {
    assumption: 'IPCA+6',
    kind: 'ipca_plus',
    used_pct: '6.00',
    basis: 'real',
    declared_pct: '6.00',
    overridden: false,
    inflation_pct: null,
  },
  pace: { monthly_contribution: '2133.00', months_measured: 12 },
  projection: {
    projected_amount: '1210000.00',
    required_monthly: '3950.00',
    arrival_date: '2043-03-31',
    months_to_arrival: 78,
    gap_brl: '290000.00',
    on_track: false,
  },
  chart: {
    dates: ['2026-09-30', '2040-01-31'],
    pace: ['318904.00', '1210000.00'],
    required: ['318904.00', '1500000.00'],
  },
  contributions: [
    {
      monthly_contribution: '2133.00',
      kind: 'current',
      arrival_date: '2043-03-31',
      months_to_arrival: 78,
      reaches_target_date: false,
    },
    {
      monthly_contribution: '3950.00',
      kind: 'required',
      arrival_date: '2040-01-31',
      months_to_arrival: 160,
      reaches_target_date: true,
    },
    {
      monthly_contribution: '5000.00',
      kind: 'option',
      arrival_date: '2039-04-30',
      months_to_arrival: 150,
      reaches_target_date: true,
    },
  ],
};

const dados = (goals: GoalResource[]): GoalsResource => ({
  reference_date: '2026-09-30',
  scope: { portfolio_id: LONGO, name: 'Longo prazo' },
  goals,
});

const montar = (
  state: Resource<GoalsResource>['state'],
  onRateChange = vi.fn(),
  rates: Record<string, string> = {},
) =>
  render(
    <PreferencesProvider storage={null}>
      <GoalsView
        resource={{ state, pending: false, reload: vi.fn() }}
        scopeLabel="Longo prazo"
        rates={rates}
        onRateChange={onRateChange}
      />
    </PreferencesProvider>,
  );

describe('GoalsView', () => {
  it('declara a taxa usada e mostra a tabela de aportes com a chegada de cada um', () => {
    montar({ kind: 'ready', value: dados([goal]) });

    expect(screen.getByRole('heading', { name: 'Objetivos' })).toBeTruthy();
    expect(screen.getByText(/Projeção com 6.00% ao ano \(real\)/)).toBeTruthy();
    expect(screen.getByText('mar/2043')).toBeTruthy();
    expect(screen.getByText('jan/2040')).toBeTruthy();
    expect(screen.getByText('necessário')).toBeTruthy();
    expect(screen.getByText('média 12M')).toBeTruthy();
    expect(screen.getByText('Atrás do necessário')).toBeTruthy();
  });

  it('criar e editar ficam desabilitados até T-10', () => {
    montar({ kind: 'ready', value: dados([goal]) });

    expect(
      (screen.getByRole('button', { name: '+ Novo objetivo' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Editar' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('a taxa digitada sobe para quem a guarda, com vírgula normalizada', async () => {
    const onRateChange = vi.fn();
    montar({ kind: 'ready', value: dados([goal]) }, onRateChange);

    await userEvent.type(screen.getByLabelText(/Taxa ao ano/), '4,5');
    await userEvent.click(screen.getByRole('button', { name: 'Simular' }));

    expect(onRateChange).toHaveBeenCalledWith(META, '4.5');
  });

  it('taxa inválida avisa e não simula', async () => {
    const onRateChange = vi.fn();
    montar({ kind: 'ready', value: dados([goal]) }, onRateChange);

    await userEvent.type(screen.getByLabelText(/Taxa ao ano/), '150');

    expect(screen.getByRole('alert').textContent).toMatch(/entre 0 e 100/);
    expect(
      (screen.getByRole('button', { name: 'Simular' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(onRateChange).not.toHaveBeenCalled();
  });

  it('taxa alterada diz qual era a premissa e oferece voltar a ela', async () => {
    const onRateChange = vi.fn();
    const alterado = {
      ...goal,
      rate: { ...goal.rate!, used_pct: '4.50', overridden: true },
    };
    montar({ kind: 'ready', value: dados([alterado]) }, onRateChange, { [META]: '4.5' });

    expect(screen.getByText(/a premissa guardada é 6.00%/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar à premissa' }));
    expect(onRateChange).toHaveBeenCalledWith(META, null);
  });

  it('projeção bloqueada explica o motivo e não desenha gráfico nem tabela', () => {
    const bloqueado: GoalResource = {
      ...goal,
      status: 'no_projection',
      blocked: 'unrecognized_assumption',
      rate: null,
      projection: null,
      chart: null,
      contributions: [],
    };
    montar({ kind: 'ready', value: dados([bloqueado]) });

    expect(screen.getByRole('status').textContent).toMatch(/não foi entendida/);
    expect(screen.queryByText('Atinge em')).toBeNull();
    expect(screen.queryByRole('img', { name: /Trajetória/ })).toBeNull();
  });

  it('atingido mostra o excedente e não projeta', () => {
    const atingido: GoalResource = {
      ...goal,
      status: 'reached',
      progress_pct: '100.00',
      remaining_brl: '0.00',
      surplus_brl: '62000.00',
      projection: null,
      chart: null,
      contributions: [],
    };
    montar({ kind: 'ready', value: dados([atingido]) });

    expect(screen.getByText('Meta atingida: não há o que projetar.')).toBeTruthy();
    expect(screen.getByText(/excedente/)).toBeTruthy();
  });

  it('prazo vencido é dito como vencido', () => {
    const vencido: GoalResource = {
      ...goal,
      status: 'overdue',
      projection: null,
      chart: null,
      contributions: [],
    };
    montar({ kind: 'ready', value: dados([vencido]) });

    expect(screen.getByRole('status').textContent).toMatch(/prazo de jan\/2040 passou/);
  });

  it('sem objetivos, vazio explicado; com erro, alerta e nova tentativa', () => {
    const { unmount } = montar({ kind: 'ready', value: dados([]) });
    expect(screen.getByText('Nenhum objetivo ainda')).toBeTruthy();
    unmount();

    montar({ kind: 'error', error: new Error('api fora do ar') });
    expect(screen.getByRole('alert').textContent).toMatch(/api fora do ar/);
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
