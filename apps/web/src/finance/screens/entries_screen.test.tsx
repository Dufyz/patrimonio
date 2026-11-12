import {
  chooseFilter,
  chooseGrouping,
  toggleDisplayColumn,
} from '../lib/test_helpers.js';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as csv from '../lib/csv.js';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { EntriesScreen } from './entries_screen.js';

const open = (path = '/', today = '2026-10-24') => {
  setTodayOverride(today);
  return render(
    <MemoryRouter initialEntries={[path]}>
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
    await chooseGrouping(name);
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

describe('busca e filtros (FIN-305)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  const strip = () => screen.getByRole('region', { name: 'Indicadores do período' });

  it('a busca recalcula tabela, contador e faixa', async () => {
    open();
    await userEvent.type(screen.getByRole('searchbox'), 'netflix');
    expect(
      within(strip()).getByText('1 lançamento', { selector: 'dd' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Spotify')).not.toBeInTheDocument();
  });

  it('filtra por situação: só previstos', async () => {
    open();
    await chooseFilter('Situação', 'Previsto');
    expect(screen.getByText('Spotify')).toBeInTheDocument();
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
  });

  it('sem resultado mostra o estado vazio com "Limpar filtros"', async () => {
    open();
    await userEvent.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText('Nenhum lançamento com esses filtros.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(
      screen.queryByText('Nenhum lançamento com esses filtros.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Netflix')).toBeInTheDocument();
  });

  it('os filtros persistem ao trocar o agrupamento', async () => {
    open();
    await chooseFilter('Tipo', 'Receita');
    await userEvent.keyboard('{Escape}');
    await chooseGrouping('Tipo');
    expect(screen.getByText('Receitas · 3 lançamentos')).toBeInTheDocument();
    expect(screen.queryByText(/^Despesas ·/)).not.toBeInTheDocument();
  });

  it('o link do Extrato chega com o filtro de conta aplicado', () => {
    open('/?conta=flex');
    expect(screen.getAllByText('1 lançamento').length).toBeGreaterThan(0);
    expect(screen.getByText('Conta de luz')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Filtrar/ })).toHaveTextContent('1');
  });
});

describe('lançar previsto (FIN-306)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('abre o modal com os dados do previsto e o valor estimado', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Lançar Gasto livre' }));
    const dialog = screen.getByRole('dialog', { name: 'Lançar previsto' });
    expect(within(dialog).getByRole('textbox', { name: 'Descrição' })).toHaveValue(
      'Gasto livre',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Valor' })).toHaveValue(
      '4.700,00',
    );
    expect(within(dialog).getByLabelText('Data')).toHaveValue('2026-10-24');
  });

  it('ao confirmar, sai dos previstos e entra nos totais', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Lançar Gasto livre' }));
    const dialog = screen.getByRole('dialog', { name: 'Lançar previsto' });
    const value = within(dialog).getByRole('textbox', { name: 'Valor' });
    await userEvent.clear(value);
    await userEvent.type(value, '4500,00');
    await userEvent.click(
      within(dialog).getByRole('button', { name: /^Lançar(?:\s*⌘↵)?$/ }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Lançar Gasto livre' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Sábado, 24/10')).toBeInTheDocument();
    expect(within(strip()).getByText(/13\.978,10/)).toBeInTheDocument();
  });

  it('cancelar não altera nada', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Lançar Gasto livre' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Lançar previsto' })).getByRole(
        'button',
        {
          name: 'Cancelar',
        },
      ),
    );
    expect(
      screen.getByRole('button', { name: 'Lançar Gasto livre' }),
    ).toBeInTheDocument();
  });
});

const strip = () => screen.getByRole('region', { name: 'Indicadores do período' });

describe('novo lançamento (FIN-307)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  const openNew = async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /^Lançamento/ }));
    return screen.getByRole('dialog', { name: 'Novo lançamento' });
  };

  it('abre pelo botão e pelo atalho N', async () => {
    open();
    await userEvent.keyboard('n');
    expect(screen.getByRole('dialog', { name: 'Novo lançamento' })).toBeInTheDocument();
  });

  it('oferece só as categorias do tipo', async () => {
    const dialog = await openNew();
    const categoria = within(dialog).getByRole('combobox', { name: 'Categoria' });
    expect(
      within(categoria).queryByRole('option', { name: 'Salário' }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Receita' }));
    expect(
      within(categoria).getByRole('option', { name: 'Salário' }),
    ).toBeInTheDocument();
    expect(
      within(categoria).queryByRole('option', { name: 'Mercado' }),
    ).not.toBeInTheDocument();
  });

  it('valida inline só depois de tentar salvar', async () => {
    const dialog = await openNew();
    expect(within(dialog).queryByText('Dê uma descrição.')).not.toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }),
    );
    expect(within(dialog).getByText('Dê uma descrição.')).toBeInTheDocument();
    expect(within(dialog).getByText('Escolha uma categoria.')).toBeInTheDocument();
  });

  it('salva e a linha aparece no dia correto, com a faixa recalculada', async () => {
    const dialog = await openNew();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Descrição' }),
      'Padaria',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Categoria' }),
      'Mercado',
    );
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Valor' }), '32,50');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Origem do pagamento' }),
      'Itaú Corrente',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Padaria')).toBeInTheDocument();
    expect(screen.getByText('Sábado, 24/10')).toBeInTheDocument();
    expect(within(strip()).getByText(/9\.510,60/)).toBeInTheDocument();
  });

  it('dividir em duas origens mostra a diferença e trava o salvar', async () => {
    const dialog = await openNew();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Valor' }),
      '100,00',
    );
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Dividir/ }));
    await userEvent.type(
      within(dialog).getAllByRole('textbox', { name: 'Parte desta origem' })[0]!,
      '60,00',
    );
    // a segunda origem recebe o que falta
    expect(within(dialog).getByRole('status')).toHaveTextContent('As partes fecham');
    expect(within(dialog).getByText('Soma das origens')).toBeTruthy();
    const second = within(dialog).getAllByRole('textbox', {
      name: 'Parte desta origem',
    })[1]!;
    await userEvent.clear(second);
    await userEvent.type(second, '30,00');
    expect(within(dialog).getByRole('status')).toHaveTextContent('Faltam R$ 10,00');
    expect(
      within(dialog).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }),
    ).toBeDisabled();
    await userEvent.clear(second);
    await userEvent.type(second, '40,00');
    expect(within(dialog).getByRole('status')).toHaveTextContent('As partes fecham');
    expect(
      within(dialog).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }),
    ).toBeEnabled();
  });

  it('cartão oferece parcelas e mostra "n parcelas de R$ x"', async () => {
    const dialog = await openNew();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Valor' }),
      '300,00',
    );
    expect(
      within(dialog).queryByRole('textbox', { name: 'Parcelas' }),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Origem do pagamento' }),
      'Itaú Visa',
    );
    const parcelas = within(dialog).getByRole('textbox', { name: 'Parcelas' });
    await userEvent.clear(parcelas);
    await userEvent.type(parcelas, '3');
    expect(within(dialog).getByText('3 parcelas de R$ 100,00')).toBeInTheDocument();
  });

  it('para data futura avisa que entra como previsto e oferece recorrente', async () => {
    const dialog = await openNew();
    fireEvent.change(within(dialog).getByLabelText('Data'), {
      target: { value: '2026-11-15' },
    });
    expect(
      within(dialog).getByRole('button', { name: 'crie um recorrente' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/entra como previsto/)).toBeInTheDocument();
  });
});

describe('menu da linha e categoria inline (FIN-308)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  const rowOf = (text: string) => {
    const row = screen
      .getAllByText(text)
      .map((el) => el.closest('tr'))
      .find((r) => r !== null);
    if (row === null || row === undefined) throw new Error(text);
    return within(row);
  };

  it('previsto tem Lançar e nenhum menu; lançado tem o menu', () => {
    open();
    expect(
      screen.queryByRole('button', { name: 'Ações de Spotify' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ações de Netflix' })).toBeInTheDocument();
  });

  it('o menu oferece Editar, Mover de conta e Excluir', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Internet' }));
    for (const name of ['Editar', 'Mover de conta', 'Excluir']) {
      expect(await screen.findByRole('menuitem', { name })).toBeInTheDocument();
    }
  });

  it('Editar abre o modal preenchido e salva', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Internet' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar lançamento' });
    const value = within(dialog).getByRole('textbox', { name: 'Valor' });
    expect(value).toHaveValue('50,00');
    await userEvent.clear(value);
    await userEvent.type(value, '55,00');
    await userEvent.click(
      within(dialog).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }),
    );
    expect(
      within(screen.getByText('Internet').closest('tr')!).getByText(/55,00/),
    ).toBeInTheDocument();
  });

  it('Excluir pede confirmação com o impacto e reverte os totais', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Netflix' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
    const dialog = screen.getByRole('dialog', { name: 'Excluir lançamento' });
    expect(dialog).toHaveTextContent('Itaú Visa recupera R$ 55,90');
    expect(dialog).toHaveTextContent('não volta a ser gerado');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
    expect(within(strip()).getByText(/9\.422,20/)).toBeInTheDocument();
  });

  it('mover de conta de compra no cartão explica o bloqueio', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Netflix' }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Mover de conta' }),
    );
    expect(screen.getByRole('dialog', { name: 'Não dá para mover' })).toHaveTextContent(
      'compra no cartão',
    );
  });

  it('mover de conta troca a conta da linha', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Internet' }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Mover de conta' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Mover de conta' });
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Mover para' }),
      'Nubank Conta',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mover' }));
    expect(rowOf('Internet').getByText('Nubank Conta')).toBeInTheDocument();
  });

  it('clicar na categoria de um lançado abre o seletor inline e salva na hora', async () => {
    open();
    await userEvent.click(
      screen.getByRole('button', { name: 'Alterar categoria de Internet' }),
    );
    const select = screen.getByRole('combobox', { name: 'Categoria de Internet' });
    expect(
      within(select).queryByRole('option', { name: 'Salário' }),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(select, 'Mercado');
    expect(rowOf('Internet').getByText('Mercado')).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Categoria de Internet' }),
    ).not.toBeInTheDocument();
  });

  it('previsto não tem categoria editável', () => {
    open();
    expect(
      screen.queryByRole('button', { name: 'Alterar categoria de Spotify' }),
    ).not.toBeInTheDocument();
  });
});

describe('seleção em lote (FIN-309)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  const pick = (name: string) =>
    userEvent.click(screen.getByRole('checkbox', { name: `Selecionar ${name}` }));

  it('previstos não são selecionáveis', () => {
    open();
    expect(
      screen.queryByRole('checkbox', { name: 'Selecionar Spotify' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Selecionar Netflix' }),
    ).toBeInTheDocument();
  });

  it('a barra aparece com a contagem e a linha fica destacada', async () => {
    open();
    expect(
      screen.queryByRole('toolbar', { name: 'Seleção em lote' }),
    ).not.toBeInTheDocument();
    await pick('Netflix');
    await pick('Internet');
    const bar = screen.getByRole('toolbar', { name: 'Seleção em lote' });
    expect(within(bar).getByText('2 selecionados')).toBeInTheDocument();
    expect(screen.getByText('Netflix').closest('tr')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    for (const name of ['Recategorizar', 'Mover de conta', 'Excluir']) {
      expect(within(bar).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('o cabeçalho seleciona todas as lançadas visíveis, e de novo limpa', async () => {
    open();
    const all = screen.getByRole('checkbox', { name: 'Selecionar todos os lançamentos' });
    await userEvent.click(all);
    expect(screen.getByText('12 selecionados')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Selecionar todos os lançamentos' }),
    );
    expect(
      screen.queryByRole('toolbar', { name: 'Seleção em lote' }),
    ).not.toBeInTheDocument();
  });

  it('Esc e o botão limpar removem a seleção', async () => {
    open();
    await pick('Netflix');
    await userEvent.keyboard('{Escape}');
    expect(
      screen.queryByRole('toolbar', { name: 'Seleção em lote' }),
    ).not.toBeInTheDocument();
    await pick('Netflix');
    await userEvent.click(screen.getByRole('button', { name: 'Limpar seleção' }));
    expect(
      screen.queryByRole('toolbar', { name: 'Seleção em lote' }),
    ).not.toBeInTheDocument();
  });

  it('recategoriza em lote', async () => {
    open();
    await pick('Internet');
    await pick('Seguro do carro');
    await userEvent.click(screen.getByRole('button', { name: 'Recategorizar' }));
    const dialog = screen.getByRole('dialog', { name: 'Recategorizar' });
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Categoria' }),
      'Lazer',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Recategorizar' }));
    expect(screen.getAllByText('Lazer').length).toBeGreaterThanOrEqual(2);
    expect(
      screen.queryByRole('toolbar', { name: 'Seleção em lote' }),
    ).not.toBeInTheDocument();
  });

  it('mover de conta é bloqueado com cartão ou duas origens, com mensagem', async () => {
    open();
    await pick('Netflix');
    await userEvent.click(screen.getByRole('button', { name: 'Mover de conta' }));
    expect(screen.getByRole('dialog', { name: 'Não dá para mover' })).toHaveTextContent(
      'cartão',
    );
  });

  it('excluir pede confirmação com a contagem e o valor total', async () => {
    open();
    await pick('Netflix');
    await pick('Internet');
    await userEvent.click(
      within(screen.getByRole('toolbar')).getByRole('button', { name: 'Excluir' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Excluir lançamentos' });
    expect(dialog).toHaveTextContent('2 lançamentos');
    expect(dialog).toHaveTextContent('R$ 105,90');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir 2' }));
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
    expect(screen.queryByText('Internet')).not.toBeInTheDocument();
  });

  it('a seleção acompanha os filtros: linhas que saem da tabela saem da seleção', async () => {
    open();
    await pick('Netflix');
    await userEvent.type(screen.getByRole('searchbox'), 'internet');
    expect(
      screen.queryByRole('toolbar', { name: 'Seleção em lote' }),
    ).not.toBeInTheDocument();
  });
});

describe('exportar (FIN-310)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  const exportNow = async () => {
    const spy = vi.spyOn(csv, 'downloadCsv').mockImplementation(() => {});
    await userEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    const call = spy.mock.calls[0];
    spy.mockRestore();
    if (call === undefined) throw new Error('não exportou');
    return { filename: call[0], rows: call[1] };
  };

  it('exporta as linhas na ordem da tela, com datas ISO e valores com ponto decimal', async () => {
    open();
    const { filename, rows } = await exportNow();
    expect(filename).toBe('lancamentos_2026-10-01_2026-10-31.csv');
    expect(rows[0]).toEqual([
      'Data',
      'Descrição',
      'Categoria',
      'Conta',
      'Detalhe',
      'Valor',
    ]);
    expect(rows[1]).toEqual([
      '2026-10-30',
      'Spotify',
      'Assinaturas',
      'Itaú Visa',
      'previsto · recorrente',
      '-21.90',
    ]);
    const luz = rows.find((row) => row[1] === 'Conta de luz');
    expect(luz).toEqual([
      '2026-10-17',
      'Conta de luz',
      'Moradia',
      'Flex + Itaú Corrente',
      'recorrente · 2 pagamentos',
      '-312.40',
    ]);
    expect(rows.find((row) => row[1] === 'Salário')?.[5]).toBe('14200.00');
    expect(rows).toHaveLength(1 + 4 + 12);
  });

  it('exporta só o que está filtrado e as colunas visíveis', async () => {
    open();
    await userEvent.type(screen.getByRole('searchbox'), 'netflix');
    await toggleDisplayColumn('Detalhe');
    await userEvent.keyboard('{Escape}');
    const { rows } = await exportNow();
    expect(rows).toEqual([
      ['Data', 'Descrição', 'Categoria', 'Conta', 'Valor'],
      ['2026-10-20', 'Netflix', 'Assinaturas', 'Itaú Visa', '-55.90'],
    ]);
  });
});

describe('previsto com data passada (FIN-311)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('continua na seção de previstos, com a data em destaque e "venceu em"', () => {
    open('/', '2026-11-02');
    const row = screen.getAllByText('Gasto livre')[0]!.closest('tr')!;
    expect(within(row).getByText('venceu em 31/10')).toBeInTheDocument();
    expect(within(row).getByText('31/10')).toHaveClass('text-attention');
    expect(within(row).getByText('previsto')).toBeInTheDocument();
  });

  it('o contador da seção distingue previstos e vencidos', () => {
    open('/', '2026-11-02');
    expect(
      screen.getByText('4 previstos · 2 vencidos · não entram nos totais do mês'),
    ).toBeInTheDocument();
  });

  it('automático não aparece como vencido', () => {
    open('/', '2026-11-02');
    const row = screen.getByText('Spotify').closest('tr')!;
    expect(within(row).queryByText(/venceu em/)).not.toBeInTheDocument();
  });

  it('sem vencidos, o contador segue o padrão', () => {
    open();
    expect(
      screen.getByText('4 lançamentos · não entram nos totais do mês'),
    ).toBeInTheDocument();
  });

  it('filtrar por previsto lista os vencidos primeiro', async () => {
    open('/', '2026-11-02');
    await chooseFilter('Situação', 'Previsto');
    const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    const order = ['Spotify', 'Gasto livre', 'Investimento', 'Aluguel'].map((name) =>
      rows.findIndex((line) => line.includes(name)),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(rows.findIndex((line) => line.includes('venceu em'))).toBeLessThan(
      rows.findIndex((line) => line.includes('Aluguel')),
    );
  });
});

describe('Exibição esconde colunas e células (correção)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('ocultar Conta e Detalhe tira cabeçalho e células', async () => {
    open();
    await toggleDisplayColumn('Conta');
    await toggleDisplayColumn('Detalhe');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('columnheader', { name: 'Conta' })).not.toBeInTheDocument();
    const row = screen.getByText('Netflix').closest('tr')!;
    expect(row.querySelectorAll('td')).toHaveLength(1 + 1 + 2 + 1 + 1); // seleção, data, descrição+categoria, valor, ação
    expect(within(row).queryByText('Itaú Visa')).not.toBeInTheDocument();
    expect(within(row).queryByText('recorrente')).not.toBeInTheDocument();
  });

  it('compra parcelada mostra a etiqueta parcela n/N', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /^Lançamento/ }));
    const dialog = screen.getByRole('dialog', { name: 'Novo lançamento' });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Descrição' }),
      'Fone',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Categoria' }),
      'Eletrônicos',
    );
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Valor' }),
      '300,00',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Origem do pagamento' }),
      'Itaú Visa',
    );
    const parcelas = within(dialog).getByRole('textbox', { name: 'Parcelas' });
    await userEvent.clear(parcelas);
    await userEvent.type(parcelas, '3');
    await userEvent.click(
      within(dialog).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }),
    );
    expect(screen.getByText('parcela 1/3')).toBeInTheDocument();
    expect(screen.getByText('parcela 2/3')).toBeInTheDocument();
  });
});

describe('modal de novo lançamento (prancha Modais A)', () => {
  const openNew = async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /^Lançamento/ }));
    return within(screen.getByRole('dialog', { name: 'Novo lançamento' }));
  };

  it('Salvar e novo grava, mantém o modal aberto e limpa o formulário', async () => {
    const dialog = await openNew();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Valor' }), '25,00');
    await userEvent.type(
      dialog.getByRole('textbox', { name: 'Descrição' }),
      'Café da tarde',
    );
    await userEvent.selectOptions(
      dialog.getByRole('combobox', { name: 'Categoria' }),
      'Mercado',
    );
    await userEvent.selectOptions(
      dialog.getByRole('combobox', { name: /Origem/ }),
      'itau-corrente',
    );
    await userEvent.click(dialog.getByRole('button', { name: /Salvar e novo/ }));
    expect(screen.getByRole('dialog', { name: 'Novo lançamento' })).toBeInTheDocument();
    expect(dialog.getByRole('textbox', { name: 'Descrição' })).toHaveValue('');
  });

  it('mostra o efeito do lançamento antes de salvar', async () => {
    const dialog = await openNew();
    await userEvent.click(dialog.getByRole('radio', { name: 'Receita' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Valor' }), '1.800,00');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Descrição' }), 'Freela');
    await userEvent.selectOptions(
      dialog.getByRole('combobox', { name: 'Categoria' }),
      'Freelas',
    );
    await userEvent.selectOptions(
      dialog.getByRole('combobox', { name: /Origem/ }),
      'itau-corrente',
    );
    const effect = within(dialog.getByRole('group', { name: 'Efeito' }));
    expect(effect.getByText(/Receitas de/)).toBeTruthy();
  });
});
