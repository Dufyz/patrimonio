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

const open = (path = '/financas/cartoes/nubank-master', today = '2026-10-24') => {
  setTodayOverride(today);
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
    expect(panel().getByText('aberta · fecha em 28/10')).toBeTruthy();
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

describe('Extrato completo da fatura (FIN-505)', () => {
  const statement = () =>
    within(screen.getByRole('table', { name: 'Extrato da fatura' }));
  const sectionOf = (title: string) =>
    statement()
      .getAllByRole('row')
      .find((row) => row.textContent?.startsWith(title))?.textContent ?? '';

  it('tem os quatro blocos na ordem, com subtotal', () => {
    open();
    const text = statement()
      .getAllByRole('row')
      .map((row) => row.textContent ?? '')
      .join('|');
    const at = [
      'Compras do período',
      'Parcelas de compras anteriores',
      'Créditos e ajustes',
      'Encargos',
    ].map((title) => text.indexOf(title));
    expect(at.every((position) => position >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(sectionOf('Compras do período')).toContain('29/09 a 28/10 · 9 lançamentos');
    expect(sectionOf('Compras do período')).toContain('R$ 2.392,17');
    expect(sectionOf('Parcelas de compras anteriores')).toContain('R$ 1.299,00');
    expect(sectionOf('Créditos e ajustes')).toContain('R$ 209,00');
  });

  it('total = compras + parcelas − créditos + encargos', () => {
    open();
    expect(sectionOf('Total da fatura')).toContain('R$ 3.482,17');
  });

  it('encargos vazio continua visível', () => {
    open();
    expect(statement().getByText('nenhum nesta fatura')).toBeTruthy();
  });

  it('parcela mostra a data da compra original e a etiqueta; crédito, o tipo', () => {
    open();
    const parcela = statement().getByRole('row', { name: 'Notebook Dell Inspiron' });
    expect(parcela.textContent).toContain('22/08');
    expect(parcela.textContent).toContain('parcela 3/6');
    const credito = statement().getByRole('row', { name: /Devolução · Amazon/ });
    expect(credito.textContent).toContain('devolução');
    expect(credito.textContent).toContain('+R$ 189,00');
  });

  it('excluir pede confirmação e recalcula o total', async () => {
    open();
    await userEvent.click(statement().getByRole('button', { name: 'Ações de Uber' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }),
    );
    expect(sectionOf('Total da fatura')).toContain('R$ 3.443,27');
  });

  it('fatura paga é somente leitura', async () => {
    open('/financas/cartoes/nubank-master?fatura=2026-10');
    await userEvent.click(statement().getAllByRole('button', { name: /Ações de/ })[0]!);
    expect(
      (await screen.findByRole('menuitem', { name: 'Excluir' })).getAttribute(
        'aria-disabled',
      ),
    ).toBe('true');
  });
});

describe('Lista de faturas (FIN-506)', () => {
  const list = () => within(screen.getByRole('table', { name: 'Faturas do cartão' }));

  it('vai da mais distante à mais antiga, com intervalo e vencimento', () => {
    open();
    const rows = list().getAllByRole('row').slice(1);
    expect(rows[0]?.textContent).toContain('fev/2027');
    expect(rows[0]?.textContent).toContain('prevista');
    expect(rows[rows.length - 1]?.textContent).toContain('ago/2026');
    const nov = list().getByRole('row', { name: 'Fatura nov/2026' }).textContent ?? '';
    expect(nov).toContain('29/09 a 28/10');
    expect(nov).toContain('05/11');
    expect(nov).toContain('R$ 3.482,17');
    expect(nov).toContain('aberta');
  });

  it('a fatura paga diz quando e por qual conta', () => {
    open();
    expect(list().getByRole('row', { name: 'Fatura out/2026' }).textContent).toContain(
      'paga em 05/10 · Nubank Conta',
    );
  });

  it('a fatura aberta fica destacada e clicar em outra troca o extrato e o navegador', async () => {
    open();
    expect(
      list().getByRole('row', { name: 'Fatura nov/2026' }).getAttribute('aria-selected'),
    ).toBe('true');
    await userEvent.click(list().getByRole('row', { name: 'Fatura dez/2026' }));
    expect(panel().getByText('dez/2026')).toBeTruthy();
    expect(
      list().getByRole('row', { name: 'Fatura dez/2026' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      within(screen.getByRole('table', { name: 'Extrato da fatura' })).getByText(
        'Notebook Dell Inspiron',
      ),
    ).toBeTruthy();
  });
});

describe('Lançar crédito (FIN-508, CE-05)', () => {
  it('cashback de R$ 15,00 reduz o total e o limite usado', async () => {
    open();
    await userEvent.click(
      panel().getByRole('button', { name: /^Lançar crédito(?:\s*⌘↵)?$/ }),
    );
    const dialog = within(screen.getByRole('dialog'));
    await userEvent.selectOptions(dialog.getByLabelText('Tipo'), 'cashback');
    await userEvent.type(dialog.getByLabelText('Descrição'), 'Cashback Nubank');
    await userEvent.type(dialog.getByLabelText('Valor'), '15');
    await userEvent.selectOptions(dialog.getByLabelText('Categoria'), 'mercado');
    await userEvent.click(
      dialog.getByRole('button', { name: /^Lançar crédito(?:\s*⌘↵)?$/ }),
    );
    expect(panel().getByLabelText('Total da fatura').textContent).toContain(
      'R$ 3.467,17',
    );
    const row = within(
      screen.getByRole('table', { name: 'Extrato da fatura' }),
    ).getByRole('row', {
      name: 'Cashback Nubank',
    });
    expect(row.textContent).toContain('+R$ 15,00');
    expect(row.textContent).toContain('cashback');
    expect(screen.getByText(/usado 61,3% · disponível R\$ 2\.192,83/)).toBeTruthy();
  });

  it('campos obrigatórios aparecem só ao salvar', async () => {
    open();
    await userEvent.click(
      panel().getByRole('button', { name: /^Lançar crédito(?:\s*⌘↵)?$/ }),
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByText('Dê uma descrição.')).toBeNull();
    await userEvent.click(
      dialog.getByRole('button', { name: /^Lançar crédito(?:\s*⌘↵)?$/ }),
    );
    expect(dialog.getByText('Dê uma descrição.')).toBeTruthy();
    expect(dialog.getByText('Informe um valor maior que zero.')).toBeTruthy();
  });

  it('fatura paga não tem a ação', () => {
    open('/financas/cartoes/nubank-master?fatura=2026-10');
    expect(
      panel().queryByRole('button', { name: /^Lançar crédito(?:\s*⌘↵)?$/ }),
    ).toBeNull();
  });
});

describe('Detalhe de qualquer cartão (FIN-509)', () => {
  it('Itaú Visa abre com a mesma estrutura, na fatura fechada', () => {
    open('/financas/cartoes/itau-visa');
    expect(screen.getByRole('heading', { level: 1, name: 'Itaú Visa' })).toBeTruthy();
    expect(panel().getByText('out/2026')).toBeTruthy();
    expect(panel().getByText('fechada')).toBeTruthy();
    expect(panel().getByLabelText('Total da fatura').textContent).toContain(
      'R$ 1.400,10',
    );
    expect(screen.getByRole('table', { name: 'Faturas do cartão' })).toBeTruthy();
  });

  it('o mês na URL abre a fatura correta', () => {
    open('/financas/cartoes/itau-mastercard?fatura=2026-10');
    expect(panel().getByText('out/2026')).toBeTruthy();
    expect(panel().getByLabelText('Total da fatura').textContent).toContain('R$ 540,00');
  });
});

describe('Compra parcelada (FIN-510, CE-07)', () => {
  const statement = () =>
    within(screen.getByRole('table', { name: 'Extrato da fatura' }));

  it('compra de R$ 3.000,00 em 6x em 20/10 cai em nov com a parcela 1 em Compras', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /^Lançamento/ }));
    const dialog = within(screen.getByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Descrição'), 'Sofá');
    await userEvent.type(dialog.getByLabelText('Valor'), '3000');
    await userEvent.selectOptions(dialog.getByLabelText('Categoria'), 'moradia');
    await userEvent.clear(dialog.getByLabelText('Data'));
    await userEvent.type(dialog.getByLabelText('Data'), '2026-10-20');
    await userEvent.type(dialog.getByLabelText('Parcelas'), '{Control>}a{/Control}6');
    expect(dialog.getByText('6 parcelas de R$ 500,00')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: /^Salvar|Lançar|Criar/ }));
    expect(panel().getByLabelText('Total da fatura').textContent).toContain(
      'R$ 3.982,17',
    );
    expect(screen.getByText(/usado 70,4% · disponível R\$ 1\.677,83/)).toBeTruthy();
    expect(statement().getByRole('row', { name: 'Sofá' }).textContent).toContain(
      'parcela 1/6',
    );
    await userEvent.click(panel().getByRole('button', { name: 'Próxima fatura' }));
    expect(panel().getByLabelText('Total da fatura').textContent).toContain(
      'R$ 1.799,00',
    );
  });

  it('excluir pergunta todas ou só as futuras', async () => {
    open('/financas/cartoes/nubank-master?fatura=2026-12');
    await userEvent.click(
      statement().getByRole('button', { name: 'Ações de Notebook Dell Inspiron' }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Só as futuras' }),
    );
    // as faturas de dez a fev deixaram de existir: volta para a vigente, e a parcela 3 fica
    expect(panel().getByText('nov/2026')).toBeTruthy();
    expect(
      (panel().getByRole('button', { name: 'Próxima fatura' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      statement().getByRole('row', { name: 'Notebook Dell Inspiron' }).textContent,
    ).toContain('parcela 3/6');
  });
});

describe('Ciclo de vida (FIN-511)', () => {
  it('a aberta mostra "fecha em" no cabeçalho', () => {
    open();
    expect(panel().getByText('aberta · fecha em 28/10')).toBeTruthy();
  });

  it('a fechada vencida e sem pagamento mostra "venceu"', () => {
    open('/financas/cartoes/itau-visa', '2026-10-31');
    expect(panel().getByText('venceu')).toBeTruthy();
  });
});

describe('Encargos (FIN-512)', () => {
  const statement = () =>
    within(screen.getByRole('table', { name: 'Extrato da fatura' }));

  it('juros soma ao total da fatura e aparece no bloco com a etiqueta', async () => {
    open();
    await userEvent.click(
      statement().getByRole('button', { name: /^Lançar encargo(?:\s*⌘↵)?$/ }),
    );
    const dialog = within(screen.getByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Valor'), '12,34');
    await userEvent.click(
      dialog.getByRole('button', { name: /^Lançar encargo(?:\s*⌘↵)?$/ }),
    );
    expect(panel().getByLabelText('Total da fatura').textContent).toContain(
      'R$ 3.494,51',
    );
    const row = statement().getByRole('row', { name: 'Juros' });
    expect(row.textContent).toContain('R$ 12,34');
    expect(statement().queryByText('nenhum nesta fatura')).toBeNull();
  });

  it('valor obrigatório só aparece ao salvar', async () => {
    open();
    await userEvent.click(
      statement().getByRole('button', { name: /^Lançar encargo(?:\s*⌘↵)?$/ }),
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByText('Informe um valor maior que zero.')).toBeNull();
    await userEvent.click(
      dialog.getByRole('button', { name: /^Lançar encargo(?:\s*⌘↵)?$/ }),
    );
    expect(dialog.getByText('Informe um valor maior que zero.')).toBeTruthy();
  });

  it('fatura paga não oferece a ação', () => {
    open('/financas/cartoes/nubank-master?fatura=2026-10');
    expect(
      statement().queryByRole('button', { name: /^Lançar encargo(?:\s*⌘↵)?$/ }),
    ).toBeNull();
    expect(statement().getByText('nenhum nesta fatura')).toBeTruthy();
  });
});
