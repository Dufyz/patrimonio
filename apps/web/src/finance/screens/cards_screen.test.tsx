import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { CardsScreen } from './cards_screen.js';

const open = () => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter initialEntries={['/cartoes']}>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <Routes>
                <Route path="/cartoes" element={<CardsScreen />} />
                <Route path="/financas/cartoes/:id" element={<p>Fatura aberta</p>} />
              </Routes>
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

const rowOf = (name: string): HTMLElement =>
  within(screen.getByRole('table', { name: 'Cartões por conta' })).getByRole('row', {
    name: new RegExp(name),
  });

describe('Cartões (FIN-501)', () => {
  it('subtítulo com faturas abertas e próximo vencimento', () => {
    open();
    expect(
      screen.getByRole('heading', { name: 'Cartões' }).parentElement?.textContent,
    ).toContain(
      'Faturas abertas R$ 5.422,27 · próximo vencimento 30/10 (Itaú Visa e Itaú Mastercard)',
    );
  });

  it('agrupa os cartões pela conta que paga', () => {
    open();
    const table = screen.getByRole('table', { name: 'Cartões por conta' });
    expect(within(table).getByText('Nubank Conta paga 1 cartão')).toBeTruthy();
    expect(within(table).getByText('Itaú Corrente paga 2 cartões')).toBeTruthy();
  });

  it('mostra fatura, situação, vencimento e limite usado', () => {
    open();
    const nubank = rowOf('Nubank Mastercard').textContent ?? '';
    expect(nubank).toContain('final 9082');
    expect(nubank).toContain('R$ 3.482,17');
    expect(nubank).toContain('aberta · fecha 28/10');
    expect(nubank).toContain('05/11');
    expect(nubank).toContain('61,5%');
    const visa = rowOf('Itaú Visa').textContent ?? '';
    expect(visa).toContain('R$ 1.400,10');
    expect(visa).toContain('fechada');
    expect(visa).toContain('30/10');
    expect(visa).toContain('em 6 dias');
    expect(visa).toContain('70,0%');
    expect(rowOf('Itaú Mastercard').textContent).toContain('13,5%');
  });

  it('clicar na linha abre o cartão', async () => {
    open();
    await userEvent.click(rowOf('Nubank Mastercard'));
    expect(screen.getByText('Fatura aberta')).toBeTruthy();
  });
});

describe('Próximas faturas (FIN-502)', () => {
  const table = () => screen.getByRole('table', { name: 'Próximas faturas' });
  const line = (month: string) =>
    within(table())
      .getAllByRole('row')
      .find((row) => row.textContent?.startsWith(month))?.textContent ?? '';

  it('tem uma coluna por cartão e o total', () => {
    open();
    const headers = within(table())
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Fatura de',
      'Nubank Mastercard',
      'Itaú Visa',
      'Itaú Mastercard',
      'Total',
    ]);
  });

  it('out, nov e dez/jan batem com a prancha', () => {
    open();
    expect(line('out/2026')).toContain('R$ 1.940,10');
    expect(line('out/2026')).toContain('fechada');
    expect(line('nov/2026')).toContain('R$ 4.303,88');
    expect(line('dez/2026')).toContain('R$ 1.905,11');
    expect(line('jan/2027')).toContain('R$ 1.905,11');
  });

  it('a coluna do cartão leva ao cartão', async () => {
    open();
    await userEvent.click(within(table()).getByRole('link', { name: 'Itaú Visa' }));
    expect(screen.getByText('Fatura aberta')).toBeTruthy();
  });

  it('cartão sem fatura a pagar mostra —', () => {
    open();
    expect(line('out/2026')).toContain('—');
  });
});

describe('Novo cartão e editar cartão (FIN-503)', () => {
  it('cria um cartão que ganha linha e coluna', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /^Cartão/ }));
    const dialog = within(screen.getByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Nome'), 'Inter Visa');
    await userEvent.type(dialog.getByLabelText('Final'), '1234');
    await userEvent.type(dialog.getByLabelText('Limite'), '3000');
    await userEvent.type(dialog.getByLabelText('Dia de fechamento'), '10');
    await userEvent.type(dialog.getByLabelText('Dia de vencimento'), '17');
    await userEvent.click(
      dialog.getByRole('button', { name: /^Criar cartão(?:\s*⌘↵)?$/ }),
    );
    expect(rowOf('Inter Visa').textContent).toContain('final 1234');
    expect(
      within(screen.getByRole('table', { name: 'Próximas faturas' }))
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toContain('Inter Visa');
  });

  it('nome repetido e campos vazios aparecem só ao salvar', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /^Cartão/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByText('Dê um nome.')).toBeNull();
    await userEvent.click(
      dialog.getByRole('button', { name: /^Criar cartão(?:\s*⌘↵)?$/ }),
    );
    expect(dialog.getByText('Dê um nome.')).toBeTruthy();
    expect(dialog.getByText('Informe o limite.')).toBeTruthy();
  });

  it('edita o limite pelo menu da linha', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Itaú Visa' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    const dialog = within(screen.getByRole('dialog'));
    const limit = dialog.getByLabelText('Limite');
    await userEvent.clear(limit);
    await userEvent.type(limit, '4000');
    await userEvent.click(dialog.getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }));
    expect(rowOf('Itaú Visa').textContent).toContain('35,0%');
  });
});

describe('Pagar fatura (FIN-507, CE-04)', () => {
  it('paga a fatura fechada do Itaú Visa e atualiza os totais', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Pagar fatura Itaú Visa' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Itaú Corrente')).toBeTruthy();
    expect(dialog.getByText('R$ 1.400,10')).toBeTruthy();
    await userEvent.click(
      dialog.getByRole('button', { name: /^Confirmar pagamento(?:\s*⌘↵)?$/ }),
    );
    const visa = rowOf('Itaú Visa').textContent ?? '';
    expect(visa).toContain('R$ 821,71');
    expect(visa).toContain('aberta');
    expect(
      screen.getByRole('heading', { name: 'Cartões' }).parentElement?.textContent,
    ).toContain('Faturas abertas R$ 4.843,88');
    const next =
      within(screen.getByRole('table', { name: 'Próximas faturas' }))
        .getAllByRole('row')
        .find((row) => row.textContent?.startsWith('out/2026'))?.textContent ?? '';
    expect(next).toContain('R$ 540,00');
    expect(next).toContain('—');
  });
});

describe('Estados (FIN-701)', () => {
  it('sem cartões: mensagem e a ação Novo cartão', async () => {
    setTodayOverride('2026-10-24');
    const empty = createFinanceStore(null);
    empty.set((current) => ({ ...current, cards: [], cardItems: [], payments: [] }));
    render(
      <MemoryRouter initialEntries={['/cartoes']}>
        <PreferencesProvider>
          <ShortcutProvider>
            <FinanceStoreProvider store={empty}>
              <FinancePeriodProvider>
                <Routes>
                  <Route path="/cartoes" element={<CardsScreen />} />
                </Routes>
              </FinancePeriodProvider>
            </FinanceStoreProvider>
          </ShortcutProvider>
        </PreferencesProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Nenhum cartão cadastrado.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Novo cartão' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('Responsividade (FIN-702)', () => {
  it('Limite usado some primeiro e Vence depois; cartão, fatura e ação ficam', () => {
    open();
    const table = within(screen.getByRole('table', { name: 'Cartões por conta' }));
    expect(table.getByRole('columnheader', { name: 'Limite usado' }).className).toContain(
      'max-xl:hidden',
    );
    expect(table.getByRole('columnheader', { name: 'Vence' }).className).toContain(
      'max-lg:hidden',
    );
    for (const name of ['Cartão', 'Fatura']) {
      const header = table.getByRole('columnheader', { name });
      expect(header.className).not.toMatch(/max-(xl|lg|md|sm):hidden/);
    }
  });
});

describe('Teclado e acessibilidade (FIN-705)', () => {
  it('o modal fecha com Esc e devolve o foco ao botão que o abriu', async () => {
    open();
    const trigger = screen.getByRole('button', { name: /^Cartão/ });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('o botão principal mostra o selo N e N abre o modal fora de um campo', async () => {
    open();
    expect(screen.getByRole('button', { name: /^Cartão/ }).textContent).toContain('N');
    await userEvent.keyboard('n');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('a situação da fatura tem texto, não só cor', () => {
    open();
    expect(rowOf('Itaú Visa').textContent).toContain('fechada');
    expect(rowOf('Nubank Mastercard').textContent).toContain('aberta');
  });
});
