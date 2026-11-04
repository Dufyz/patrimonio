import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { EntriesScreen } from './entries_screen.js';

const open = () => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <EntriesScreen />
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

describe('faixa de indicadores (FIN-301)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('mostra título, subtítulo e o período', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Lançamentos' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Todas as contas e cartões · por dia, do mais recente ao mais antigo',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Período: 01/10 – 31/10' }),
    ).toBeInTheDocument();
  });

  it('tem as quatro células com os valores da prancha 02A', () => {
    open();
    const strip = screen.getByRole('region', { name: 'Indicadores do período' });
    const cell = (label: string) => {
      const term = within(strip).getByText(label);
      const box = term.parentElement;
      if (box === null) throw new Error(label);
      return within(box);
    };
    expect(cell('Receitas').getByText(/16\.350,00/)).toBeInTheDocument();
    expect(cell('Receitas').getByText('3 lançamentos')).toBeInTheDocument();
    expect(cell('Despesas').getByText(/9\.478,10/)).toBeInTheDocument();
    expect(cell('Despesas').getByText('9 lançamentos')).toBeInTheDocument();
    const saldo = cell('Saldo do período').getByText(/6\.871,90/);
    expect(saldo.textContent).toMatch(/^\+\s?R\$/);
    expect(cell('Ainda a lançar').getByText(/6\.871,90/)).toBeInTheDocument();
    expect(cell('Ainda a lançar').getByText('3 previstos até 31/10')).toBeInTheDocument();
  });

  it('o botão principal é Lançamento com o selo N', () => {
    open();
    expect(screen.getByRole('button', { name: /Lançamento/ })).toBeInTheDocument();
  });
});

describe('tabela por dia (FIN-302)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('tem as colunas do documento', () => {
    open();
    for (const name of ['Data', 'Descrição', 'Categoria', 'Conta', 'Detalhe', 'Valor']) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
    }
  });

  it('a primeira seção traz os previstos, do mais próximo ao mais distante', () => {
    open();
    const rows = screen.getAllByRole('row').map((row) => row.textContent ?? '');
    expect(rows[1]).toContain('Próximos dias · previstos');
    expect(rows[1]).toContain('4 lançamentos · não entram nos totais do mês');
    expect(rows[2]).toContain('Spotify');
    expect(rows[3]).toContain('Gasto livre');
    expect(rows[5]).toContain('Aluguel e condomínio');
    expect(rows[5]).toContain('10/11');
  });

  it('depois vêm os dias, do mais novo ao mais antigo, com o resumo', () => {
    open();
    const text = screen.getAllByRole('row').map((row) => row.textContent ?? '');
    const at = (value: string) => text.findIndex((line) => line.includes(value));
    expect(at('Quarta, 21/10')).toBeGreaterThan(at('Aluguel e condomínio'));
    expect(at('Quarta, 21/10')).toBeLessThan(at('Terça, 20/10'));
    expect(at('Terça, 20/10')).toBeLessThan(at('Sábado, 17/10'));
    expect(text[at('Quarta, 21/10')]).toContain('despesas R$ 4.500,00');
    expect(text[at('Quinta, 15/10')]).toContain(
      'receitas R$ 350,00 · despesas R$ 504,00',
    );
    expect(text[at('Segunda, 12/10')]).toContain('receitas R$ 1.800,00');
    expect(text[at('Segunda, 12/10')]).not.toContain('despesas');
  });

  it('previstos têm "previsto" e o botão Lançar; recorrentes têm "recorrente"', () => {
    open();
    const row = (name: string) => {
      const found = screen
        .getAllByText(name)
        .map((el) => el.closest('tr'))
        .find((r) => r !== null);
      if (found === null || found === undefined) throw new Error(name);
      return within(found);
    };
    expect(row('Spotify').getByText('previsto')).toBeInTheDocument();
    expect(
      row('Spotify').getByRole('button', { name: 'Lançar Spotify' }),
    ).toBeInTheDocument();
    expect(row('Netflix').getByText('recorrente')).toBeInTheDocument();
    expect(row('Freela · Projeto Lume').getByText('recorrente')).toBeInTheDocument();
  });

  it('receita com + e despesa com −', () => {
    open();
    const salario = screen.getAllByText('Salário')[0]?.closest('tr');
    expect(salario?.textContent).toMatch(/\+\s?R\$\s?14\.200,00/);
    const aluguel = screen.getAllByText('Aluguel e condomínio')[1]?.closest('tr');
    expect(aluguel?.textContent).toMatch(/−\s?R\$\s?3\.200,00/);
  });

  it('o rodapé traz a legenda', () => {
    open();
    expect(screen.getByText(/repete todo mês/)).toBeInTheDocument();
    expect(screen.getByText(/também são filtros/)).toBeInTheDocument();
  });

  it('a conta de luz mostra as duas origens', () => {
    open();
    expect(screen.getByText('Flex + Itaú Corrente')).toBeInTheDocument();
  });
});

describe('despesa paga por duas origens (FIN-303)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('a linha mostra o total, as duas contas e a etiqueta "2 pagamentos"', () => {
    open();
    const row = screen.getByText('Conta de luz').closest('tr');
    expect(row?.textContent).toContain('Flex + Itaú Corrente');
    expect(row?.textContent).toContain('2 pagamentos');
    expect(row?.textContent).toMatch(/−\s?R\$\s?312,40/);
  });

  it('os subitens vêm logo abaixo, com a parte de cada origem', () => {
    open();
    const rows = screen.getAllByRole('row');
    const index = rows.findIndex((row) => row.textContent?.includes('Conta de luz'));
    expect(rows[index + 1]?.textContent).toContain('Pago com Flex');
    expect(rows[index + 1]?.textContent).toContain('R$ 150,00');
    expect(rows[index + 2]?.textContent).toContain('Pago com Itaú Corrente');
    expect(rows[index + 2]?.textContent).toContain('R$ 162,40');
  });

  it('despesa de uma origem não tem subitens', () => {
    open();
    expect(screen.getAllByText(/^Pago com/)).toHaveLength(2);
  });
});

describe('agrupar (FIN-304)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  const group = async (name: string) => {
    await userEvent.click(screen.getByRole('button', { name: /^Agrupar:/ }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: new RegExp(`^${name}`) }),
    );
  };

  it('abre por dia e mostra o seletor "Agrupar: Dia"', () => {
    open();
    expect(screen.getByRole('button', { name: 'Agrupar: Dia' })).toBeInTheDocument();
  });

  it('por tipo: seções com contagem e o subtítulo acompanha', async () => {
    open();
    await group('Tipo');
    expect(
      screen.getByText('Todas as contas e cartões · receitas e despesas'),
    ).toBeInTheDocument();
    expect(screen.getByText('Receitas · 3 lançamentos')).toBeInTheDocument();
    expect(screen.getByText('Despesas · 13 lançamentos')).toBeInTheDocument();
    expect(
      screen.getByText('despesas R$ 9.478,10 · previsto R$ 10.071,90'),
    ).toBeInTheDocument();
  });

  it('por categoria e por conta', async () => {
    open();
    await group('Categoria');
    expect(
      screen.getByText('Todas as contas e cartões · por categoria'),
    ).toBeInTheDocument();
    expect(screen.getByText('Moradia · 4 lançamentos')).toBeInTheDocument();
    await group('Conta');
    expect(screen.getByText('Todas as contas e cartões · por conta')).toBeInTheDocument();
    expect(screen.getByText('Itaú Visa · 3 lançamentos')).toBeInTheDocument();
  });

  it('a faixa não muda ao trocar o agrupamento e a escolha persiste', async () => {
    open();
    const before = screen.getByRole('region', {
      name: 'Indicadores do período',
    }).textContent;
    await group('Categoria');
    expect(
      screen.getByRole('region', { name: 'Indicadores do período' }).textContent,
    ).toBe(before);
    expect(globalThis.localStorage.getItem('patrimonio.finance.entries-grouping')).toBe(
      'categoria',
    );
  });
});
