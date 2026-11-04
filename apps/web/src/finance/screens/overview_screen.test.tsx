import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { OverviewScreen } from './overview_screen.js';

const open = () => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter initialEntries={['/visao-geral']}>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <Routes>
                <Route path="/visao-geral" element={<OverviewScreen />} />
                <Route path="/financas/lancamentos" element={<p>Lançamentos aberto</p>} />
              </Routes>
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

describe('Faixa de totais do mês (FIN-601)', () => {
  it('cabeçalho do painel com a etiqueta e o dia do mês', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Resultado de out/2026' })).toBeTruthy();
    expect(screen.getByText('mês em andamento')).toBeTruthy();
    expect(screen.getByText('dia 24 de 31')).toBeTruthy();
  });

  it('cinco células com valores e legendas', () => {
    open();
    const strip = within(screen.getByRole('region', { name: 'Resultado do mês' }));
    const cell = (label: string) =>
      strip.getByText(label).parentElement?.textContent ?? '';
    expect(cell('Receitas')).toContain('R$ 16.350,00');
    expect(cell('Receitas')).toContain('3 lançamentos');
    expect(cell('Despesas')).toContain('R$ 9.478,10');
    expect(cell('Despesas')).toContain('9 lançamentos');
    expect(cell('Saldo do mês')).toContain('R$ 6.871,90');
    expect(cell('Em contas')).toContain('R$ 11.773,15');
    expect(cell('Em contas')).toContain('3 contas');
    expect(cell('Faturas abertas')).toContain('R$ 5.422,27');
    expect(cell('Faturas abertas')).toContain('Itaú 30/10 · Nubank 05/11');
  });
});

describe('Receitas × despesas (FIN-602)', () => {
  it('painel com subtítulo, legenda do mês do período e 12 meses no eixo', () => {
    open();
    const panel = screen.getByRole('region', { name: 'Receitas × despesas' });
    expect(within(panel).getByText('últimos 12 meses')).toBeTruthy();
    expect(within(panel).getByText('Receitas')).toBeTruthy();
    expect(within(panel).getByText('R$ 16.350')).toBeTruthy();
    expect(within(panel).getByText('Despesas')).toBeTruthy();
    expect(within(panel).getByText('R$ 9.478')).toBeTruthy();
    const months = panel.querySelectorAll('[data-month]');
    expect(months).toHaveLength(12);
    expect(months[0]?.getAttribute('data-month')).toBe('2025-11');
    expect(months[11]?.getAttribute('data-month')).toBe('2026-10');
  });

  it('o mês em andamento é o único com o tom cheio', () => {
    open();
    const panel = screen.getByRole('region', { name: 'Receitas × despesas' });
    expect(panel.querySelectorAll('[data-strong="true"]')).toHaveLength(1);
    expect(
      panel.querySelector('[data-month="2026-10"]')?.getAttribute('data-strong'),
    ).toBe('true');
  });

  it('o tooltip mostra mês, receitas, despesas e saldo', async () => {
    open();
    const panel = screen.getByRole('region', { name: 'Receitas × despesas' });
    await userEvent.hover(panel.querySelector('[data-month="2026-10"]')!);
    const tip = within(screen.getByRole('tooltip'));
    expect(tip.getByText('out/2026')).toBeTruthy();
    expect(screen.getByRole('tooltip').textContent).toContain('R$ 16.350,00');
    expect(screen.getByRole('tooltip').textContent).toContain('R$ 9.478,10');
    expect(screen.getByRole('tooltip').textContent).toContain('R$ 6.871,90');
  });
});

describe('Despesas por categoria (FIN-603)', () => {
  const panel = () => screen.getByRole('region', { name: 'Despesas por categoria' });
  const table = () =>
    within(screen.getByRole('table', { name: 'Despesas por categoria' }));

  it('subtítulo com o mês e "até agora", e a coluna de comparação com o mês anterior', () => {
    open();
    expect(within(panel()).getByText('out/2026 · até agora')).toBeTruthy();
    expect(table().getByRole('columnheader', { name: 'SET/2026' })).toBeTruthy();
  });

  it('ordena da maior para a menor e mostra marcador, valor, variação e percentual', () => {
    open();
    const rows = table().getAllByRole('row').slice(1);
    expect(rows[0]?.textContent).toContain('Investimento');
    expect(rows[0]?.textContent).toContain('R$ 4.500,00');
    expect(rows[0]?.textContent).toContain('R$ 6.200,00');
    expect(rows[0]?.textContent).toContain('−27%');
    expect(rows[0]?.textContent).toContain('47,5%');
    expect(rows[1]?.textContent).toContain('Moradia');
    expect(rows[1]?.textContent).toContain('+4%');
  });

  it('variação menor é verde e maior é vermelha; os percentuais somam 100%', () => {
    open();
    const rows = table().getAllByRole('row').slice(1);
    const cellTone = (row: HTMLElement | undefined) =>
      row?.querySelector('td:nth-child(4)')?.className ?? '';
    expect(cellTone(rows[0])).toContain('text-positive');
    expect(cellTone(rows[1])).toContain('text-negative');
    const total = rows
      .map((row) =>
        Number(
          (row.querySelector('td:nth-child(5)')?.textContent ?? '0')
            .replace(',', '.')
            .replace('%', ''),
        ),
      )
      .reduce((a, b) => a + b, 0);
    expect(Math.round(total * 10) / 10).toBe(100);
  });

  it('a barra empilhada tem um trecho por categoria e o link leva a Lançamentos', async () => {
    open();
    expect(panel().querySelectorAll('[data-category]').length).toBe(
      table().getAllByRole('row').length - 1,
    );
    await userEvent.click(
      within(panel()).getByRole('link', { name: 'Ver os lançamentos' }),
    );
    expect(screen.getByText('Lançamentos aberto')).toBeTruthy();
  });
});

describe('Card Lançamentos (FIN-604)', () => {
  const card = () => screen.getByRole('region', { name: 'Lançamentos' });

  it('duas seções, cinco lançados no máximo e previstos até três', () => {
    open();
    const items = within(card()).getAllByRole('listitem');
    const text = items.map((item) => item.textContent ?? '');
    expect(text[0]).toContain('Lançados');
    const plannedAt = text.findIndex((t) => t.startsWith('Previstos'));
    expect(plannedAt).toBeGreaterThan(0);
    expect(plannedAt - 1).toBeLessThanOrEqual(5);
    expect(text.length - plannedAt - 1).toBeLessThanOrEqual(3);
    expect(card().querySelectorAll('[data-status="lancada"]')).toHaveLength(
      plannedAt - 1,
    );
  });

  it('cada linha traz data, origem e categoria na segunda linha, e o valor com sinal', () => {
    open();
    const first = within(card()).getAllByRole('listitem')[1]?.textContent ?? '';
    expect(first).toMatch(/\d{2}\/\d{2} · .+ · .+/);
    expect(first).toMatch(/[+−]R\$/);
  });

  it('o botão Lançamento abre o novo lançamento e o link abre Lançamentos', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /^Lançamento/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(
      within(card()).getByRole('link', { name: 'Ver todos os lançamentos' }),
    );
    expect(screen.getByText('Lançamentos aberto')).toBeTruthy();
  });
});
