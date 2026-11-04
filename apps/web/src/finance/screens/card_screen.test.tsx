import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { CardScreen } from './card_screen.js';

const open = (path = '/financas/cartoes/nubank-master') => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <Routes>
                <Route path="/financas/cartoes/:id" element={<CardScreen />} />
                <Route path="/financas/cartoes" element={<p>Lista de cartões</p>} />
              </Routes>
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

const panel = () => within(screen.getByRole('region', { name: 'Fatura' }));

describe('Fatura: cabeçalho e navegador de mês (FIN-504)', () => {
  it('título, migalhas e subtítulo do cartão', () => {
    open();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Nubank Mastercard' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'final 9082 · pertence a Nubank Conta · limite R$ 5.660,00 · usado 61,5% · disponível R$ 2.177,83',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cartões' })).toBeTruthy();
  });

  it('abre na fatura vigente, com situação e resumo', () => {
    open();
    expect(panel().getByText('nov/2026')).toBeTruthy();
    expect(panel().getByText('aberta')).toBeTruthy();
    expect(
      panel().getByText(
        'compras de 29/09 a 28/10 · fecha em 28/10 · vence em 05/11 · paga com Nubank Conta',
      ),
    ).toBeTruthy();
    expect(panel().getByLabelText('Total da fatura').textContent).toContain(
      'R$ 3.482,17',
    );
  });

  it('as setas andem entre as faturas e param nas pontas', async () => {
    open();
    await userEvent.click(panel().getByRole('button', { name: 'Próxima fatura' }));
    expect(panel().getByText('dez/2026')).toBeTruthy();
    expect(panel().getByText('prevista')).toBeTruthy();
    expect(panel().getByLabelText('Total da fatura').textContent).toContain(
      'R$ 1.299,00',
    );
    for (let i = 0; i < 8; i += 1) {
      const next = panel().getByRole('button', { name: 'Próxima fatura' });
      if ((next as HTMLButtonElement).disabled) break;
      await userEvent.click(next);
    }
    expect(
      (panel().getByRole('button', { name: 'Próxima fatura' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(panel().getByText('fev/2027')).toBeTruthy();
  });

  it('a fatura vem da URL e a paga mostra quando e com qual conta', () => {
    open('/financas/cartoes/nubank-master?fatura=2026-10');
    expect(panel().getByText('paga')).toBeTruthy();
    expect(panel().getByText(/paga em 05\/10 · Nubank Conta/)).toBeTruthy();
  });

  it('Lançamento abre o novo lançamento com o cartão escolhido', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /^Lançamento/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(
      (dialog.getByLabelText('Origem do pagamento') as HTMLSelectElement)
        .selectedOptions[0]?.textContent,
    ).toContain('Nubank Mastercard');
  });

  it('cartão inexistente volta para a lista', () => {
    open('/financas/cartoes/nao-existe');
    expect(screen.getByText('Lista de cartões')).toBeTruthy();
  });
});
