import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { StatementScreen } from './statement_screen.js';

const open = (id = 'itau-corrente') => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter initialEntries={[`/financas/contas/${id}`]}>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <Routes>
                <Route path="/financas/contas/:id" element={<StatementScreen />} />
                <Route path="/financas/contas" element={<p>Lista de contas</p>} />
              </Routes>
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

const header = () =>
  within(screen.getByRole('region', { name: 'Saldo de Itaú Corrente' }));

describe('Extrato: cabeçalho de saldo (FIN-405)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('título, migalhas e subtítulo com tipo, instituição e cartão', () => {
    open();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Itaú Corrente' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Conta corrente · Itaú Unibanco · cartões Itaú Visa e Itaú Mastercard',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contas' })).toHaveAttribute(
      'href',
      '/financas/contas',
    );
  });

  it('painel com nome, etiqueta do papel e as ações Editar e Transferir', () => {
    open();
    const panel = header();
    expect(panel.getByRole('heading', { name: 'Itaú Corrente' })).toBeInTheDocument();
    expect(panel.getByText('recebe receitas e paga despesas')).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(panel.getByRole('button', { name: /^Transferir(?:\s*⌘↵)?$/ })).toBeInTheDocument();
  });

  it('saldo atual em destaque e a legenda de como se formou', () => {
    open();
    const panel = header();
    expect(panel.getByLabelText('Saldo atual').textContent).toBe('R$ 3.112,80');
    expect(panel.getByText(/saldo de 01\/10/).textContent).toBe(
      'saldo de 01/10: R$ 2.133,55 · entrou R$ 16.350,00 · saiu R$ 15.370,75',
    );
  });

  it('entradas e saídas incluem transferência e fatura (Nubank)', () => {
    open('nubank-conta');
    const panel = within(screen.getByRole('region', { name: 'Saldo de Nubank Conta' }));
    expect(panel.getByText(/saldo de 01\/10/).textContent).toBe(
      'saldo de 01/10: R$ 7.766,00 · entrou R$ 4.700,00 · saiu R$ 4.045,65',
    );
    expect(panel.getByLabelText('Saldo atual').textContent).toBe('R$ 8.420,35');
  });

  it('Transferir abre o modal com a origem preenchida e atualiza o saldo', async () => {
    const user = userEvent.setup();
    open();
    await user.click(header().getByRole('button', { name: /^Transferir(?:\s*⌘↵)?$/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('De')).toHaveValue('itau-corrente');
    await user.selectOptions(dialog.getByLabelText('Para'), 'nubank-conta');
    await user.type(dialog.getByLabelText('Valor'), '500,00');
    await user.click(dialog.getByRole('button', { name: /^Transferir(?:\s*⌘↵)?$/ }));
    expect(header().getByLabelText('Saldo atual').textContent).toBe('R$ 2.612,80');
  });

  it('Editar altera o nome na hora', async () => {
    const user = userEvent.setup();
    open('carteira');
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Editar conta' }));
    await user.clear(dialog.getByLabelText('Nome'));
    await user.type(dialog.getByLabelText('Nome'), 'Dinheiro');
    await user.click(dialog.getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Dinheiro' }),
    ).toBeInTheDocument();
  });

  it('benefício não oferece Transferir', () => {
    open('flex');
    expect(screen.queryByRole('button', { name: /^Transferir(?:\s*⌘↵)?$/ })).not.toBeInTheDocument();
    expect(screen.getByText('Benefício')).toBeInTheDocument();
  });

  it('conta que não existe volta para a lista', () => {
    open('nao-existe');
    expect(screen.getByText('Lista de contas')).toBeInTheDocument();
  });

  it('mostra o gráfico de saldo dia a dia dentro do painel', () => {
    open();
    expect(
      header().getByRole('img', { name: /^Saldo dia a dia de Itaú Corrente/ }),
    ).toBeInTheDocument();
  });
});

describe('Extrato: tabela com saldo após (FIN-407)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  const table = () =>
    within(screen.getByRole('table', { name: 'Extrato de Itaú Corrente' }));
  const rows = () => table().getAllByRole('row').slice(1);
  const rowOf = (text: string) => {
    const row = rows().find(
      (r) => r.querySelector('td:nth-child(2)')?.firstChild?.textContent === text,
    );
    if (row === undefined) throw new Error(`sem linha ${text}`);
    return row;
  };

  it('título, período e contagem de movimentações', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Extrato' })).toBeInTheDocument();
    expect(screen.getByText('out/2026 · 12 movimentações')).toBeInTheDocument();
  });

  it('da mais nova para a mais antiga, com o saldo após de cada linha', () => {
    open();
    const text = rows().map((r) => r.textContent ?? '');
    expect(text).toHaveLength(12);
    expect(text[0]).toContain('21/10');
    expect(text[0]).toContain('Investimento');
    expect(text[0]).toContain('R$ 3.112,80');
    expect(text.at(-1)).toContain('Salário');
    expect(text.at(-1)).toContain('R$ 16.333,55');
    expect(rowOf('Aluguel e condomínio').textContent).toContain('R$ 6.129,20');
  });

  it('mesmo dia: receitas antes, e a transferência por último (saldo 10.831,65)', () => {
    open();
    const day5 = rows().filter((r) => (r.textContent ?? '').startsWith('05/10'));
    expect(
      day5.map((r) => r.querySelector('td:nth-child(2)')?.firstChild?.textContent),
    ).toEqual([
      'Transferência para Nubank Conta',
      'Plano de vida',
      'Plano de saúde',
      'Salário',
    ]);
    expect(day5[0]?.textContent).toContain('R$ 10.831,65');
  });

  it('etiquetas e descrições secundárias', () => {
    open();
    expect(rowOf('Salário').textContent).toContain('recorrente');
    expect(rowOf('Conta de luz').textContent).toContain('2 pagamentos');
    expect(rowOf('Conta de luz').textContent).toContain(
      'parte da conta · R$ 150,00 saíram do Flex',
    );
    expect(rowOf('Conta de luz').textContent).toContain('−R$ 162,40');
    expect(rowOf('Transferência para Nubank Conta').textContent).toContain(
      'saldo livre do mês',
    );
    expect(rowOf('Transferência para Nubank Conta').textContent).toContain(
      'transferência',
    );
  });

  it('fatura e transferência não têm categoria; pagamento da fatura é uma linha só', () => {
    open();
    const fatura = rowOf('Pagamento da fatura Itaú Visa (set)');
    expect(fatura.textContent).toContain('fatura');
    expect(fatura.querySelector('td:nth-child(3)')?.textContent).toBe('—');
    expect(
      rowOf('Transferência para Nubank Conta').querySelector('td:nth-child(3)')
        ?.textContent,
    ).toBe('—');
    expect(table().queryByText('Netflix')).not.toBeInTheDocument();
    expect(table().queryByText('Academia')).not.toBeInTheDocument();
  });

  it('entradas em verde com +, saídas com −', () => {
    open();
    expect(rowOf('Salário').textContent).toContain('+R$ 14.200,00');
    expect(rowOf('Aluguel e condomínio').textContent).toContain('−R$ 3.200,00');
  });

  it('o link do rodapé abre Lançamentos filtrado por esta conta', () => {
    open();
    expect(
      screen.getByRole('link', { name: 'Ver em Lançamentos com filtro desta conta' }),
    ).toHaveAttribute('href', '/financas/lancamentos?conta=itau-corrente');
  });

  it('período sem movimentação mostra o aviso', () => {
    open('carteira');
    expect(screen.getByText('out/2026 · 1 movimentação')).toBeInTheDocument();
  });
});

describe('Extrato de benefício (FIN-408)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('mostra o saldo e as partes pagas pelo Flex', () => {
    open('flex');
    const panel = within(screen.getByRole('region', { name: 'Saldo de Flex' }));
    expect(panel.getByLabelText('Saldo atual').textContent).toBe('R$ 198,30');
    const table = within(screen.getByRole('table', { name: 'Extrato de Flex' }));
    const row = table.getByText('Conta de luz').closest('tr');
    expect(row?.textContent).toContain('−R$ 150,00');
    expect(row?.textContent).toContain('2 pagamentos');
    expect(row?.textContent).toContain(
      'parte da conta · R$ 162,40 saíram do Itaú Corrente',
    );
  });
});
