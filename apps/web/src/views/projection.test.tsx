import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import { setTodayOverride } from '../finance/lib/clock.js';
import { PLAN_KEY } from '../lib/investment_plan_store.js';
import { ProjectionScreen } from './projection.js';

const portfolios = [
  { id: 'p-inv', name: 'Investimentos' },
  { id: 'p-res', name: 'Reserva' },
] as never;
const values = { 'p-inv': '100000.00', 'p-res': '20000.00' };

const open = (portfolioId: string | null = null) => {
  setTodayOverride('2026-11-09');
  return render(
    <PreferencesProvider>
      <ProjectionScreen
        portfolios={portfolios}
        portfolioId={portfolioId}
        values={values}
      />
    </PreferencesProvider>,
  );
};

const table = () => screen.getByRole('table', { name: 'Projeção mês a mês' });
const firstRow = () => within(table()).getAllByRole('row')[1]?.textContent ?? '';

const addRule = async (name: string, amount: string) => {
  await userEvent.click(
    screen.getByRole('button', { name: `Adicionar regra em ${name}` }),
  );
  await userEvent.type(screen.getByLabelText(`Novo valor por mês, ${name}`), amount);
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
};

const seed = () =>
  window.localStorage.setItem(
    PLAN_KEY,
    JSON.stringify({
      rules: [
        { id: 'a', portfolioId: 'p-inv', cents: 700000, from: '2026-12', until: null },
        { id: 'b', portfolioId: 'p-res', cents: 300000, from: '2026-12', until: null },
      ],
      rates: {},
    }),
  );

describe('Projeção de Investimentos', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('sem plano, mostra o valor de hoje das carteiras e a partir de quando projeta', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Projeção' })).toBeTruthy();
    expect(screen.getByText(/a partir de dez\/2026/)).toBeTruthy();
    expect(screen.getByText('Nas carteiras hoje').parentElement?.textContent).toContain(
      'R$ 120.000',
    );
    expect(screen.getAllByText(/Nenhuma regra/).length).toBe(2);
  });

  it('só valor fixo, sem Finanças, sem objetivos e sem seletor de carteira na tela', () => {
    open();
    expect(screen.queryByText(/Finanças/)).toBeNull();
    expect(screen.queryByText(/Objetivos/)).toBeNull();
    expect(screen.queryByLabelText('Percentual')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Reserva' })).toBeNull();
  });

  it('o formulário de regra só abre ao pedir, dentro do bloco da carteira, e cancela', async () => {
    open();
    expect(screen.queryByLabelText('Novo valor por mês, Reserva')).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'Adicionar regra em Reserva' }),
    );
    expect(screen.getByLabelText('Novo valor por mês, Reserva')).toBeTruthy();
    expect(screen.queryByLabelText('Novo valor por mês, Investimentos')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Novo valor por mês, Reserva')).toBeNull();
  });

  it('aporte fixo por carteira entra na tabela mês a mês e no total por mês', async () => {
    open();
    await addRule('Investimentos', '7000,00');
    await addRule('Reserva', '3000,00');

    const first = firstRow();
    expect(first).toContain('dez/2026');
    expect(first).toContain('R$ 107.000'); // Investimentos: 100.000 + 7.000
    expect(first).toContain('R$ 23.000'); // Reserva: 20.000 + 3.000
    expect(first).toContain('R$ 130.000'); // total
    expect(screen.getByTestId('plan-total').textContent).toContain('R$ 10.000');
    const saved = window.localStorage.getItem(PLAN_KEY) ?? '';
    expect(saved).toContain('"cents":700000');
    expect(saved).toContain('"cents":300000');
  });

  it('valida antes de salvar e fecha a linha ao salvar', async () => {
    open();
    await userEvent.click(
      screen.getByRole('button', { name: 'Adicionar regra em Reserva' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('alert').textContent).toContain(
      'Informe um valor maior que zero.',
    );
    await userEvent.type(screen.getByLabelText('Novo valor por mês, Reserva'), '100,00');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.queryByLabelText('Novo valor por mês, Reserva')).toBeNull();
    expect(screen.getByLabelText('Valor por mês da regra de Reserva')).toBeTruthy();
  });

  it('edita uma regra no lugar: valor e período', async () => {
    open();
    await addRule('Investimentos', '1000,00');
    expect(firstRow()).toContain('R$ 101.000');

    const value = screen.getByLabelText('Valor por mês da regra de Investimentos');
    await userEvent.clear(value);
    expect(firstRow()).toContain('R$ 101.000'); // vazio é inválido: fica o último válido
    await userEvent.type(value, '2500,00');
    expect(firstRow()).toContain('R$ 102.500');
    expect(screen.getByTestId('plan-total').textContent).toContain('R$ 2.500');

    await userEvent.type(screen.getByLabelText('Até, regra de Investimentos'), '2026-12');
    const rows = within(table()).getAllByRole('row');
    expect(rows[2]?.textContent).toContain('R$ 102.500'); // jan: o aporte acabou em dez
  });

  it('remove uma regra', async () => {
    seed();
    open();
    await userEvent.click(
      screen.getByRole('button', { name: 'Remover regra de Reserva' }),
    );
    expect(screen.queryByLabelText('Valor por mês da regra de Reserva')).toBeNull();
    expect(firstRow()).toContain('R$ 20.000');
  });

  it('o total por mês soma as carteiras', () => {
    seed();
    open();
    expect(screen.getByTestId('plan-total').textContent).toContain('R$ 10.000');
  });

  it('rentabilidade aceita duas casas, tem máscara de % e fica salva', async () => {
    open();
    const before = screen.getByText('Rendimento estimado').parentElement?.textContent;
    const field = screen.getByLabelText('Rentabilidade esperada · Investimentos');
    await userEvent.type(field, '13,759');
    expect((field as HTMLInputElement).value).toBe('13,75');
    expect(screen.getByText('Rendimento estimado').parentElement?.textContent).not.toBe(
      before,
    );
    expect(window.localStorage.getItem(PLAN_KEY)).toContain('"p-inv":1375');
  });

  it('a rentabilidade não passa de 100%', async () => {
    open();
    const field = screen.getByLabelText('Rentabilidade esperada · Reserva');
    await userEvent.type(field, '1000');
    expect((field as HTMLInputElement).value).toBe('10');
  });

  it('um plano salvo volta ao reabrir', () => {
    window.localStorage.setItem(
      PLAN_KEY,
      JSON.stringify({
        rules: [
          { id: 'r1', portfolioId: 'p-res', cents: 500000, from: '2026-12', until: null },
        ],
        rates: { 'p-inv': 1375 },
      }),
    );
    open();
    expect(
      (
        screen.getByLabelText(
          'Rentabilidade esperada · Investimentos',
        ) as HTMLInputElement
      ).value,
    ).toBe('13,75');
    expect(
      (screen.getByLabelText('Valor por mês da regra de Reserva') as HTMLInputElement)
        .value,
    ).toBe('5.000,00');
    expect(firstRow()).toContain('R$ 25.000');
  });

  it('trocar o horizonte muda o número de meses', async () => {
    open();
    const rows = () => within(table()).getAllByRole('row').length - 1;
    expect(rows()).toBe(24);
    await userEvent.click(screen.getByRole('radio', { name: '12 meses' }));
    expect(rows()).toBe(12);
  });
});

describe('Gráfico: legenda e valores ponto a ponto', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('numa carteira: total, valor de hoje, aporte e rendimento, com os valores ao passar o mouse', async () => {
    window.localStorage.setItem(
      PLAN_KEY,
      JSON.stringify({
        rules: [
          { id: 'a', portfolioId: 'p-res', cents: 100000, from: '2026-12', until: null },
        ],
        rates: {},
      }),
    );
    open('p-res');
    const legend = within(screen.getByRole('list', { name: 'Legenda' }));
    expect(legend.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Total',
      'Valor de hoje',
      'Aporte',
      'Rendimento',
    ]);
    expect(screen.queryByRole('tooltip')).toBeNull();

    await userEvent.hover(screen.getByTestId('projection-hit'));
    const tip = screen.getByRole('tooltip');
    const lines = Array.from(tip.children).map((child) => child.textContent ?? '');
    expect(lines[0]).toMatch(/jan\/2027|dez\/2026|hoje|\//);
    expect(lines[1]).toContain('Total');
    expect(lines[2]).toContain('Valor de hoje');
    expect(lines[2]).toContain('R$ 20.000');
    expect(lines[3]).toContain('Aporte');
    expect(lines[4]).toContain('Rendimento');
  });

  it('em todas: total e uma linha por carteira, com os valores no tooltip', async () => {
    seed();
    open(null);
    const legend = within(screen.getByRole('list', { name: 'Legenda' }));
    expect(legend.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Total',
      'Investimentos',
      'Reserva',
    ]);
    await userEvent.hover(screen.getByTestId('projection-hit'));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Investimentos');
    expect(tip.textContent).toContain('Reserva');
  });
});

describe('A carteira escolhida no seletor do topo', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('com uma carteira, mostra só ela, com aporte acumulado e o plano dela', () => {
    seed();
    open('p-res');
    expect(screen.getByText('Na carteira hoje').parentElement?.textContent).toContain(
      'R$ 20.000',
    );
    expect(
      within(table()).getByRole('columnheader', { name: 'Aporte acumulado' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Rentabilidade esperada · Reserva')).toBeTruthy();
    expect(screen.queryByLabelText('Rentabilidade esperada · Investimentos')).toBeNull();
    expect(screen.queryByLabelText('Valor por mês da regra de Investimentos')).toBeNull();
    expect(screen.getByTestId('plan-total').textContent).toContain('R$ 3.000');
    const second = within(table()).getAllByRole('row')[2]?.textContent ?? '';
    expect(second).toContain('R$ 6.000'); // aporte acumulado: 2 × 3.000
    expect(second).toContain('R$ 26.000');
    expect(document.querySelector('[data-layer="aportes"]')).not.toBeNull();
  });

  it('em todas, mostra as carteiras juntas', () => {
    seed();
    open(null);
    expect(screen.getByText('Nas carteiras hoje')).toBeTruthy();
    expect(document.querySelector('[data-line="total"]')).not.toBeNull();
    expect(document.querySelector('[data-layer]')).toBeNull();
  });
});
