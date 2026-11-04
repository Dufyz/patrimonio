import type { GoalResource, GoalsResource } from '@patrimonio/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteGoal, previewGoal, putGoal } from '../api/goals.js';
import { PreferencesProvider } from '../components/preferences.js';
import type { Resource } from '../lib/use_resource.js';
import { GoalsView } from './goals.js';

vi.mock('../api/goals.js', () => ({
  fetchGoals: vi.fn(),
  previewGoal: vi.fn(),
  putGoal: vi.fn(),
  deleteGoal: vi.fn(),
}));

const LONGO = '0191e5a0-0000-7000-8000-00000000c001';
const META = '019b0000-0000-7000-8000-0000000000a1';

const goal: GoalResource = {
  id: META,
  name: 'Independência financeira',
  target_amount: '1500000.00',
  target_date: '2040-01-01',
  amount_in_today_brl: true,
  return_assumption: 'IPCA+6',
  created_on: '2025-01-01',
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

const dados = (meta: GoalResource | null): GoalsResource => ({
  reference_date: '2026-09-30',
  scope: { portfolio_id: LONGO, name: 'Longo prazo' },
  goal: meta,
});

const montar = (
  state: Resource<GoalsResource>['state'],
  onRateChange = vi.fn(),
  rate: string | null = null,
  reload = vi.fn(),
) =>
  render(
    <PreferencesProvider storage={null}>
      <GoalsView
        resource={{ state, pending: false, reload }}
        portfolioId={LONGO}
        scopeLabel="Longo prazo"
        rate={rate}
        onRateChange={onRateChange}
      />
    </PreferencesProvider>,
  );

describe('GoalsView', () => {
  beforeEach(() => {
    vi.mocked(previewGoal).mockReset();
    vi.mocked(putGoal).mockReset();
    vi.mocked(deleteGoal).mockReset();
  });

  it('declara a taxa usada e mostra a tabela de aportes com a chegada de cada um', () => {
    montar({ kind: 'ready', value: dados(goal) });

    expect(screen.getByRole('heading', { name: 'Objetivos' })).toBeTruthy();
    expect(screen.getByText(/Projeção com 6.00% ao ano \(real\)/)).toBeTruthy();
    expect(screen.getAllByText('mar/2043').length).toBeGreaterThan(0);
    expect(screen.getAllByText('jan/2040').length).toBeGreaterThan(0);
    expect(screen.getByText('necessário')).toBeTruthy();
    expect(screen.getByText('média 12M')).toBeTruthy();
    expect(screen.getByText('Abaixo do ritmo')).toBeTruthy();
  });

  it('com objetivo definido não há como criar outro, e editar está disponível', () => {
    montar({ kind: 'ready', value: dados(goal) });

    expect(screen.queryByRole('button', { name: 'Novo objetivo' })).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Editar' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('a taxa digitada sobe para quem a guarda, com vírgula normalizada', async () => {
    const onRateChange = vi.fn();
    montar({ kind: 'ready', value: dados(goal) }, onRateChange);

    await userEvent.type(screen.getByLabelText(/Taxa ao ano/), '4,5');
    await userEvent.click(screen.getByRole('button', { name: 'Simular' }));

    expect(onRateChange).toHaveBeenCalledWith('4.5');
  });

  it('taxa inválida avisa e não simula', async () => {
    const onRateChange = vi.fn();
    montar({ kind: 'ready', value: dados(goal) }, onRateChange);

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
    montar({ kind: 'ready', value: dados(alterado) }, onRateChange, '4.5');

    expect(screen.getByText(/a premissa guardada é 6.00%/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar à premissa' }));
    expect(onRateChange).toHaveBeenCalledWith(null);
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
    montar({ kind: 'ready', value: dados(bloqueado) });

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
    montar({ kind: 'ready', value: dados(atingido) });

    expect(screen.getByText('Meta atingida: não há o que projetar.')).toBeTruthy();
    expect(screen.getByText(/Excedente/)).toBeTruthy();
  });

  it('prazo vencido é dito como vencido', () => {
    const vencido: GoalResource = {
      ...goal,
      status: 'overdue',
      projection: null,
      chart: null,
      contributions: [],
    };
    montar({ kind: 'ready', value: dados(vencido) });

    expect(screen.getByRole('status').textContent).toMatch(/prazo de jan\/2040 passou/);
  });

  it('sem objetivo, vazio explicado; com erro, alerta e nova tentativa', () => {
    const { unmount } = montar({ kind: 'ready', value: dados(null) });
    expect(screen.getByText('Nenhum objetivo ainda')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Novo objetivo' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    unmount();

    montar({ kind: 'error', error: new Error('api fora do ar') });
    expect(screen.getByRole('alert').textContent).toMatch(/api fora do ar/);
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  describe('o modal do objetivo', () => {
    const depois: GoalResource = {
      ...goal,
      progress_pct: '30.00',
      projection: { ...goal.projection!, required_monthly: '3000.00' },
    };

    it('Editar abre o formulário com o objetivo e mostra o resultado antes e depois', async () => {
      vi.mocked(previewGoal).mockResolvedValue(depois);
      montar({ kind: 'ready', value: dados(goal) });

      await userEvent.click(screen.getByRole('button', { name: 'Editar' }));

      expect(screen.getByRole('heading', { name: 'Editar objetivo' })).toBeTruthy();
      expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe(
        'Independência financeira',
      );
      expect((screen.getByLabelText('Data') as HTMLInputElement).value).toBe('jan/2040');
      expect((screen.getByLabelText('Valor alvo') as HTMLInputElement).value).toBe(
        '1.500.000,00',
      );
      expect(screen.getByLabelText('Premissa de retorno')).toHaveProperty(
        'value',
        'IPCA+6',
      );

      expect(await screen.findByText(/R\$\s*3\.000/)).toBeTruthy();
      expect(vi.mocked(previewGoal)).toHaveBeenCalledWith(
        LONGO,
        expect.objectContaining({
          target_date: '2040-01-01',
          return_assumption: 'IPCA+6',
        }),
        expect.anything(),
      );
    });

    it('salvar grava na carteira da tela, mantém a data e recarrega', async () => {
      vi.mocked(previewGoal).mockResolvedValue(depois);
      vi.mocked(putGoal).mockResolvedValue({});
      const reload = vi.fn();
      montar({ kind: 'ready', value: dados(goal) }, vi.fn(), null, reload);

      await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
      const nome = screen.getByLabelText('Nome');
      await userEvent.clear(nome);
      await userEvent.type(nome, 'Liberdade');
      await userEvent.click(screen.getByRole('button', { name: /^Salvar/ }));

      await vi.waitFor(() => expect(reload).toHaveBeenCalled());
      expect(vi.mocked(putGoal)).toHaveBeenCalledWith(LONGO, {
        name: 'Liberdade',
        target_amount: '1500000.00',
        target_date: '2040-01-01',
        return_assumption: 'IPCA+6',
        amount_in_today_brl: true,
      });
    });

    it('Novo objetivo abre vazio, aponta o que falta e não grava', async () => {
      montar({ kind: 'ready', value: dados(null) });

      await userEvent.click(screen.getByRole('button', { name: 'Novo objetivo' }));
      expect(screen.getByRole('heading', { name: 'Novo objetivo' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: /^Salvar/ }));

      expect(screen.getByText('Dê um nome ao objetivo.')).toBeTruthy();
      expect(screen.getByText('Informe um valor maior que zero.')).toBeTruthy();
      expect(screen.getByText('Use mês e ano, como jun/2030.')).toBeTruthy();
      expect(vi.mocked(putGoal)).not.toHaveBeenCalled();
      expect(vi.mocked(previewGoal)).not.toHaveBeenCalled();
    });

    it('o que a api recusa aparece no modal, e o modal continua aberto', async () => {
      vi.mocked(previewGoal).mockResolvedValue(depois);
      vi.mocked(putGoal).mockRejectedValue(
        new Error('A data do objetivo precisa ser futura'),
      );
      montar({ kind: 'ready', value: dados(goal) });

      await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
      await userEvent.click(screen.getByRole('button', { name: /^Salvar/ }));

      expect((await screen.findByRole('alert')).textContent).toMatch(
        /precisa ser futura/,
      );
      expect(screen.getByRole('heading', { name: 'Editar objetivo' })).toBeTruthy();
    });

    it('Excluir pede a confirmação, nomeia o objetivo e diz o que não muda', async () => {
      vi.mocked(previewGoal).mockResolvedValue(depois);
      montar({ kind: 'ready', value: dados(goal) });

      await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
      await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));

      expect(
        screen.getByRole('heading', { name: 'Excluir Independência financeira?' }),
      ).toBeTruthy();
      expect(
        screen.getByText(/Posições, lançamentos e patrimônio não mudam/),
      ).toBeTruthy();
      expect(vi.mocked(deleteGoal)).not.toHaveBeenCalled();
    });
  });
});
