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

describe('Composição da tela (FVG-008)', () => {
  it('o subtítulo diz o período e as contagens do cadastro', () => {
    open();
    expect(
      screen.getByText(
        /Finanças · out\/2026 · receitas e despesas · 5 contas e \d+ cartões/u,
      ),
    ).toBeTruthy();
  });

  it('tem os seis painéis e não tem mais a faixa de resultado nem a projeção em tabela', () => {
    open();
    for (const name of [
      'Saldo previsto',
      'Despesas por categoria',
      'Próximos lançamentos',
      'Faturas abertas',
      'Contas',
      'Receitas × despesas',
    ]) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('region', { name: 'Resultado do mês' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Projeção mês a mês' })).toBeNull();
  });
});

describe('Saldo previsto (FVG-001, FVG-002)', () => {
  const panel = () => screen.getByRole('region', { name: 'Saldo previsto' });

  it('mostra a data de hoje, o saldo ao fim do mês e Em contas hoje', () => {
    open();
    expect(within(panel()).getByText(/hoje, .* · fim de out\/2026/u)).toBeTruthy();
    expect(within(panel()).queryByText('dia 24 de 31')).toBeNull();
    expect(within(panel()).getByText('Saldo ao fim do mês')).toBeTruthy();
    expect(panel().textContent).toContain('R$ 12.583,85');
  });

  it('tem as três linhas com barra e o menor saldo do horizonte', () => {
    open();
    for (const label of ['Em contas hoje', 'Entradas previstas', 'Saídas previstas']) {
      expect(within(panel()).getByText(label)).toBeTruthy();
    }
    expect(within(panel()).getByText(/Menor saldo até 30\/11/u)).toBeTruthy();
  });

  it('cada linha leva ao que a compõe', () => {
    open();
    const link = within(panel()).getByText('Saídas previstas').closest('a');
    expect(link?.getAttribute('href')).toBe(
      '/financas/lancamentos?tipo=despesa&situacao=prevista',
    );
  });

  it('o gráfico traz realizado e previsto e marca o menor saldo', () => {
    open();
    expect(
      within(panel()).getByRole('img', { name: /realizado até hoje e previsto depois/u }),
    ).toBeTruthy();
    expect(within(panel()).getByLabelText('Menor saldo')).toBeTruthy();
  });
});

describe('Receitas × despesas (FIN-602)', () => {
  it('painel com subtítulo, legenda do mês do período e 12 meses no eixo', () => {
    open();
    const panel = screen.getByRole('region', { name: 'Receitas × despesas' });
    expect(within(panel).getByText(/últimos 12 meses/)).toBeTruthy();
    expect(within(panel).getByText('Receitas')).toBeTruthy();
    expect(within(panel).getByText('R$ 16.350')).toBeTruthy();
    expect(within(panel).getByText('Despesas')).toBeTruthy();
    expect(within(panel).getByText('R$ 9.478')).toBeTruthy();
    const months = panel.querySelectorAll('[data-month]:not([data-future])');
    expect(months).toHaveLength(12);
    expect(months[0]?.getAttribute('data-month')).toBe('2025-11');
    expect(months[11]?.getAttribute('data-month')).toBe('2026-10');
  });

  it('os três meses seguintes entram como previstos, sem o tom cheio', () => {
    open();
    const panel = screen.getByRole('region', { name: 'Receitas × despesas' });
    const future = panel.querySelectorAll('[data-future="true"]');
    expect(Array.from(future).map((g) => g.getAttribute('data-month'))).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
    expect(panel.querySelectorAll('[data-strong="true"]')).toHaveLength(1);
    expect(within(panel).getByText('Previsto')).toBeTruthy();
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

describe('Despesas por categoria (FVG-003)', () => {
  const panel = () => screen.getByRole('region', { name: 'Despesas por categoria' });
  const table = () =>
    within(screen.getByRole('table', { name: 'Despesas por categoria' }));

  it('subtítulo com o mês e "até agora", sem coluna de variação', () => {
    open();
    expect(within(panel()).getByText('out/2026 · até agora')).toBeTruthy();
    expect(table().queryByRole('columnheader', { name: 'Variação' })).toBeNull();
    expect(table().getByRole('columnheader', { name: '% do total' })).toBeTruthy();
  });

  it('ordena da maior para a menor, com valor e percentual, e fecha com o total', () => {
    open();
    const rows = table().getAllByRole('row').slice(1);
    expect(rows[0]?.textContent).toContain('Investimento');
    expect(rows[0]?.textContent).toContain('R$ 4.500,00');
    expect(rows[0]?.textContent).toContain('47,5%');
    expect(rows[rows.length - 1]?.textContent).toContain('Total');
    expect(rows[rows.length - 1]?.textContent).toContain('R$ 9.478,10');
  });

  it('o link leva a Lançamentos de despesas lançadas', () => {
    open();
    expect(
      within(panel())
        .getByRole('link', { name: /^Ver por categoria/u })
        .getAttribute('href'),
    ).toBe('/financas/lancamentos?tipo=despesa&situacao=lancada');
  });
});

describe('Próximos lançamentos (FVG-004)', () => {
  const panel = () => screen.getByRole('region', { name: 'Próximos lançamentos' });

  it('lista até nove previstos, do mais próximo ao mais distante', () => {
    open();
    const rows = within(panel()).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(9);
    expect(
      within(panel()).getByRole('columnheader', { name: 'Conta ou cartão' }),
    ).toBeTruthy();
  });

  it('o link do cabeçalho diz o total real de previstos e leva a Lançamentos', () => {
    open();
    const link = within(panel()).getByRole('link', { name: /^Ver os \d+ previstos/u });
    expect(link.getAttribute('href')).toBe('/financas/lancamentos?situacao=prevista');
  });
});

describe('Faturas abertas e Contas (FVG-005, FVG-006)', () => {
  it('Faturas abertas mostra fatura e limite por cartão, com o total no rodapé', () => {
    open();
    const panel = screen.getByRole('region', { name: 'Faturas abertas' });
    expect(within(panel).getByText('% do limite usado')).toBeTruthy();
    expect(within(panel).getByRole('columnheader', { name: 'Limite' })).toBeTruthy();
    expect(panel.textContent).toContain('R$ 5.422,27');
    expect(panel.textContent).toMatch(/fecham \d\d\/\d\d · vencem \d\d\/\d\d/u);
  });

  it('Contas fecha com o total em contas, igual ao de Em contas hoje', () => {
    open();
    const panel = screen.getByRole('region', { name: 'Contas' });
    expect(within(panel).getByText('Total em contas')).toBeTruthy();
    expect(panel.textContent).toContain('R$ 12.583,85');
  });
});

describe('Novo lançamento', () => {
  it('o botão Lançamento abre o formulário', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /^Lançamento/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('a Visão geral não tem mais o card de lançamentos', () => {
    open();
    expect(screen.queryByRole('region', { name: 'Lançamentos' })).toBeNull();
  });
});
