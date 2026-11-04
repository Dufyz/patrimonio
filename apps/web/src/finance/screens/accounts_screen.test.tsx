import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { AccountsScreen } from './accounts_screen.js';

const open = () => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter initialEntries={['/contas']}>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <Routes>
                <Route path="/contas" element={<AccountsScreen />} />
                <Route path="/financas/contas/:id" element={<p>Extrato aberto</p>} />
              </Routes>
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

const mainTable = () =>
  within(screen.getByRole('table', { name: 'Contas e benefícios' }));

const rowOf = (name: string) => {
  const row = mainTable().getByText(name).closest('tr');
  if (row === null) throw new Error(`sem linha para ${name}`);
  return row;
};

describe('Contas (FIN-401)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('o subtítulo resume saldo, variação e data', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Contas' })).toBeInTheDocument();
    const subtitle = screen.getByText(/saldos de 24\/10\/2026/);
    expect(subtitle.textContent).toContain('Em contas R$ 11.773,15');
    expect(subtitle.textContent).toContain('+R$ 1.573,60 no mês');
  });

  it('colunas e seções', () => {
    open();
    for (const name of ['Conta', 'Cartão', 'Saldo', 'Variação no mês']) {
      expect(mainTable().getByRole('columnheader', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('entram no saldo em contas')).toBeInTheDocument();
    expect(screen.getByText('ficam fora do saldo em contas')).toBeInTheDocument();
  });

  it('Itaú Corrente: papel, cartão, saldo e variação', () => {
    open();
    const row = within(rowOf('Itaú Corrente'));
    expect(row.getByText('Recebe as receitas e paga as despesas')).toBeInTheDocument();
    expect(row.getByText('Itaú Visa')).toBeInTheDocument();
    expect(row.getByText('R$ 3.112,80')).toBeInTheDocument();
    expect(rowOf('Itaú Corrente').textContent).toContain('+R$ 979,25');
  });

  it('conta sem cartão mostra traço e variação negativa', () => {
    open();
    const row = within(rowOf('Carteira'));
    expect(row.getByText('—')).toBeInTheDocument();
    expect(row.getByText('R$ 240,00')).toBeInTheDocument();
    expect(rowOf('Carteira').textContent).toContain('−R$ 60,00');
  });

  it('Total em contas soma só as contas', () => {
    open();
    const row = within(rowOf('Total em contas'));
    expect(row.getByText('R$ 11.773,15')).toBeInTheDocument();
    expect(rowOf('Total em contas').textContent).toContain('+R$ 1.573,60');
  });

  it('benefícios mostram o crédito mensal no lugar da variação', () => {
    open();
    const vale = within(rowOf('Vale Alimentação'));
    expect(vale.getByText('R$ 612,40')).toBeInTheDocument();
    expect(vale.getByText('R$ 1.100,00')).toBeInTheDocument();
    expect(vale.getByText('todo dia 05')).toBeInTheDocument();
    const flex = within(rowOf('Flex'));
    expect(flex.getByText('R$ 198,30')).toBeInTheDocument();
    expect(flex.getByText('R$ 400,00')).toBeInTheDocument();
  });

  it('clicar na linha abre o Extrato', async () => {
    open();
    await userEvent.click(mainTable().getByText('Nubank Conta'));
    expect(screen.getByText('Extrato aberto')).toBeInTheDocument();
  });

  it('o menu ⋯ lista Editar, Transferir e Arquivar', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Carteira' }));
    expect(screen.getByRole('menuitem', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Transferir' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Arquivar' })).toBeInTheDocument();
    expect(screen.queryByText('Extrato aberto')).not.toBeInTheDocument();
  });

  describe('Últimas movimentações (FIN-402)', () => {
    const panel = () => {
      const section = screen
        .getByRole('heading', { name: 'Últimas movimentações' })
        .closest('section');
      if (section === null) throw new Error('sem painel');
      return within(section);
    };

    it('painel com título, link e oito linhas da mais nova para a mais antiga', () => {
      open();
      expect(panel().getByRole('link', { name: 'Ver em Lançamentos' })).toHaveAttribute(
        'href',
        '/financas/lancamentos',
      );
      const rows = panel().getAllByRole('row').slice(1);
      expect(rows).toHaveLength(8);
      expect(rows[0]?.textContent).toContain('Investimento');
      expect(rows[0]?.textContent).toContain('21/10');
    });

    it('despesa com duas origens aparece uma vez, com o total', () => {
      open();
      const luz = panel().getAllByText('Conta de luz');
      expect(luz).toHaveLength(1);
      const text = luz[0]?.closest('tr')?.textContent ?? '';
      expect(text).toContain('Flex + Itaú Corrente');
      expect(text).toContain('2 pagamentos');
      expect(text).toContain('−R$ 312,40');
    });

    it('as colunas pedidas e categoria com o marcador', () => {
      open();
      for (const name of ['Data', 'Descrição', 'Categoria', 'Conta', 'Valor']) {
        expect(panel().getByRole('columnheader', { name })).toBeInTheDocument();
      }
    });
  });
});

describe('Transferir (FIN-403)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('o botão do cabeçalho abre o modal e a transferência atualiza os saldos', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Transferir' }));
    const dialog = within(
      screen.getByRole('dialog', { name: 'Transferir entre contas' }),
    );
    await user.selectOptions(dialog.getByLabelText('De'), 'itau-corrente');
    await user.selectOptions(dialog.getByLabelText('Para'), 'nubank-conta');
    await user.type(dialog.getByLabelText('Valor'), '500,00');
    await user.click(dialog.getByRole('button', { name: 'Transferir' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(rowOf('Itaú Corrente').textContent).toContain('R$ 2.612,80');
    expect(rowOf('Nubank Conta').textContent).toContain('R$ 8.920,35');
    expect(rowOf('Total em contas').textContent).toContain('R$ 11.773,15');
  });

  it('pelo menu ⋯ a origem já vem preenchida', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Ações de Nubank Conta' }));
    await user.click(screen.getByRole('menuitem', { name: 'Transferir' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('De')).toHaveValue('nubank-conta');
  });

  it('mostra os erros só ao tentar salvar', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Transferir' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByText('Escolha a conta de origem.')).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Transferir' }));
    expect(dialog.getByText('Escolha a conta de origem.')).toBeInTheDocument();
    expect(dialog.getByText('Informe um valor maior que zero.')).toBeInTheDocument();
  });

  it('origem e destino iguais ficam sem salvar', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Transferir' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.selectOptions(dialog.getByLabelText('De'), 'carteira');
    await user.selectOptions(dialog.getByLabelText('Para'), 'carteira');
    await user.type(dialog.getByLabelText('Valor'), '10,00');
    await user.click(dialog.getByRole('button', { name: 'Transferir' }));
    expect(
      dialog.getByText('Origem e destino precisam ser contas diferentes.'),
    ).toBeInTheDocument();
  });

  it('benefício não oferece Transferir no menu', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Ações de Flex' }));
    expect(screen.getByRole('menuitem', { name: 'Transferir' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
