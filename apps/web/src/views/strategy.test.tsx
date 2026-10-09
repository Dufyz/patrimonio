import type { AllocationResource } from '@patrimonio/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import type { Resource } from '../lib/use_resource.js';
import { StrategyScreen, StrategyView } from './strategy.js';
import type { StrategyViewProps } from './strategy.js';

/**
 * O que a tela promete e o teste cobra: o alvo se edita na tabela e a soma que
 * não fecha 100% trava o salvar, dizendo o que falta; o corpo que sai tem só o
 * que tem alvo; sem estratégia o desvio é traço e não zero; o plano de aporte
 * usa o que está salvo.
 */
type Node = AllocationResource['composition']['nodes'][number];

const line = (
  id: string,
  name: string,
  current: string,
  target: string | null,
  extra: Partial<Node> = {},
): Node => ({
  id,
  name,
  color_token: `class.${id}`,
  level: 'category',
  value: '1000.00',
  current_pct: current,
  target_pct: target,
  deviation_pp: target === null ? null : '0.30',
  over_tolerance: false,
  amount_to_move: target === null ? null : '-100.00',
  target_value: target === null ? null : '900.00',
  children: [],
  ...extra,
});

const ACOES = '019b0000-0000-7000-8000-0000000000a1';
const FIIS = '019b0000-0000-7000-8000-0000000000a2';
const CAIXA = '019b0000-0000-7000-8000-0000000000a3';

const allocation = (overrides: Partial<AllocationResource> = {}): AllocationResource => ({
  reference_date: '2026-10-06',
  portfolio: {
    id: '0191e5a0-0000-7000-8000-00000000c001',
    name: 'Longo prazo',
    purpose: 'Longo prazo',
    recalc_status: 'idle',
  },
  rules: {
    tolerance_pp: '3.00',
    max_asset_weight_pct: '15.00',
    rebalance_mode: 'contributions_only',
    review_every_months: 6,
    reviewed_on: '2026-07-09',
    next_review_on: '2027-01-09',
    benchmark: { id: '019b0000-0000-7000-8000-000000000009', name: 'IPCA + 6%' },
  },
  strategy_defined: true,
  composition: {
    total: '3000.00',
    nodes: [
      line('rv', 'Renda variável', '60.00', '60.00', {
        level: 'group',
        children: [
          line(ACOES, 'Ações', '35.30', '35.00') as never,
          line(FIIS, 'FIIs', '24.70', '25.00') as never,
        ],
      }),
      line(CAIXA, 'Caixa', '2.30', '40.00'),
    ],
    target_sum: { total_pct: '100.00', missing_pp: '0.00', closes: true },
    target_rejected: false,
  },
  contribution: null,
  ...overrides,
});

const ready = (value: AllocationResource): Resource<AllocationResource> => ({
  state: { kind: 'ready', value },
  pending: false,
  reload: () => {},
});

const show = (
  value: AllocationResource,
  props: Partial<StrategyViewProps> = {},
): { onSave: ReturnType<typeof vi.fn>; onSaveRules: ReturnType<typeof vi.fn> } => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onSaveRules = vi.fn().mockResolvedValue(undefined);

  render(
    <PreferencesProvider storage={null}>
      <StrategyView
        resource={ready(value)}
        onSave={onSave}
        onSaveRules={onSaveRules}
        onPlan={vi.fn().mockResolvedValue(null)}
        {...props}
      />
    </PreferencesProvider>,
  );

  return { onSave, onSaveRules };
};

const field = (name: string): HTMLInputElement =>
  screen.getByRole('textbox', { name: `Alvo de ${name}` });

const retype = async (name: string, text: string): Promise<void> => {
  const input = field(name);
  await userEvent.clear(input);
  if (text !== '') await userEvent.type(input, text);
};

describe('as regras', () => {
  it('mostra as cinco, com o valor de cada uma', () => {
    show(allocation());

    expect(screen.getByText('± 3 pp')).toBeInTheDocument();
    expect(screen.getByText('15%')).toBeInTheDocument();
    expect(screen.getByText('Só com aportes')).toBeInTheDocument();
    expect(screen.getByText('A cada 6 meses')).toBeInTheDocument();
    expect(screen.getByText(/Próxima revisão em jan\/2027/)).toBeInTheDocument();
    expect(screen.getByText('IPCA + 6%')).toBeInTheDocument();
  });

  it('salva só a regra que foi editada', async () => {
    const { onSaveRules } = show(allocation());

    await userEvent.click(screen.getByRole('button', { name: 'Editar tolerância' }));
    const dialog = screen.getByRole('dialog', { name: 'Tolerância' });
    const input = within(dialog).getByRole('textbox', { name: 'Tolerância' });
    await userEvent.clear(input);
    await userEvent.type(input, '2,5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(onSaveRules).toHaveBeenCalledWith({ tolerance_pp: '2.50' }),
    );
  });

  it('tolerância zero não salva, e peso máximo vazio é sem limite', async () => {
    const { onSaveRules } = show(allocation());

    await userEvent.click(screen.getByRole('button', { name: 'Editar tolerância' }));
    const first = screen.getByRole('dialog', { name: 'Tolerância' });
    await userEvent.clear(within(first).getByRole('textbox', { name: 'Tolerância' }));
    await userEvent.type(within(first).getByRole('textbox', { name: 'Tolerância' }), '0');
    expect(within(first).getByRole('button', { name: 'Salvar' })).toBeDisabled();
    await userEvent.click(within(first).getByRole('button', { name: 'Cancelar' }));

    await userEvent.click(screen.getByRole('button', { name: 'Editar peso máximo' }));
    const second = screen.getByRole('dialog', { name: 'Peso máximo por ativo' });
    await userEvent.clear(
      within(second).getByRole('textbox', { name: 'Peso máximo por ativo' }),
    );
    await userEvent.click(within(second).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(onSaveRules).toHaveBeenCalledWith({ max_asset_weight_pct: null }),
    );
  });

  it('o benchmark ainda não se edita aqui, e a dica diz onde', () => {
    show(allocation());

    expect(
      screen.getByRole('button', { name: /chega com Configurações/ }),
    ).toBeDisabled();
  });
});

describe('a tabela', () => {
  it('o grupo é a soma das categorias, e o total fecha 100%', () => {
    show(allocation());

    const grupo = screen.getByRole('row', { name: /Renda variável/ });
    expect(within(grupo).getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('✓ 100%')).toBeInTheDocument();
  });

  it('recolher o grupo esconde as categorias dele e só elas', async () => {
    show(allocation());

    await userEvent.click(
      screen.getByRole('button', { name: 'Recolher Renda variável' }),
    );

    expect(
      screen.queryByRole('textbox', { name: 'Alvo de Ações' }),
    ).not.toBeInTheDocument();
    expect(field('Caixa')).toBeInTheDocument();
  });

  it('sem estratégia o desvio e os valores são traço, e não zero', () => {
    const none = allocation({
      strategy_defined: false,
      composition: {
        ...allocation().composition,
        nodes: [line(CAIXA, 'Caixa', '100.00', null)],
      },
    });
    show(none);

    const caixa = screen.getByRole('row', { name: /Caixa/ });
    expect(within(caixa).getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(within(caixa).queryByText(/0,0 pp/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Planejar aporte' })).toBeDisabled();
  });

  it('a linha acima da tolerância fica marcada', () => {
    const over = allocation();
    const node = over.composition.nodes[1];
    if (node === undefined) throw new Error('fixture');
    node.over_tolerance = true;
    node.deviation_pp = '-37.70';
    show(over);

    const caixa = screen.getByRole('row', { name: /Caixa/ });
    expect(within(caixa).getByTitle('Acima da tolerância')).toBeInTheDocument();
  });
});

describe('editar e salvar', () => {
  it('sem alteração não há barra de salvar', () => {
    show(allocation());

    expect(screen.queryByRole('region', { name: 'Alterações não salvas' })).toBeNull();
  });

  it('soma que não fecha trava o salvar e diz quanto falta', async () => {
    show(allocation());

    await retype('Ações', '30');

    const bar = screen.getByRole('region', { name: 'Alterações não salvas' });
    expect(
      within(bar).getByText(/Soma 95% · faltam 5 pp para salvar/),
    ).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Salvar estratégia/ })).toBeDisabled();
  });

  it('trocar 35/25 por 30/30 fecha a soma e libera o salvar', async () => {
    show(allocation());

    await retype('Ações', '30');
    await retype('FIIs', '30');

    const bar = screen.getByRole('region', { name: 'Alterações não salvas' });
    expect(within(bar).getByText('2 alterações não salvas')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Salvar estratégia/ })).toBeEnabled();
  });

  it('envia só o que tem alvo, com ponto e duas casas', async () => {
    const { onSave } = show(allocation());

    await retype('Ações', '30,5');
    await retype('FIIs', '29,5');
    await userEvent.click(screen.getByRole('button', { name: /Salvar estratégia/ }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        targets: [
          { category_id: ACOES, target_pct: '30.50' },
          { category_id: FIIS, target_pct: '29.50' },
          { category_id: CAIXA, target_pct: '40.00' },
        ],
      }),
    );
  });

  it('campo inválido se marca e trava, sem adivinhar o número', async () => {
    show(allocation());

    await retype('Ações', 'abc');

    expect(field('Ações')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Corrija 1 campo para salvar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar estratégia/ })).toBeDisabled();
  });

  it('descartar volta ao salvo e some com a barra', async () => {
    show(allocation());

    await retype('Ações', '10');
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(field('Ações')).toHaveValue('35');
    expect(screen.queryByRole('region', { name: 'Alterações não salvas' })).toBeNull();
  });

  it('digitar de volta o valor salvo desfaz a alteração', async () => {
    show(allocation());

    await retype('Ações', '10');
    await retype('Ações', '35');

    expect(screen.queryByRole('region', { name: 'Alterações não salvas' })).toBeNull();
  });

  it('⌘S salva sem sair do campo', async () => {
    const { onSave } = show(allocation());

    await retype('Ações', '30');
    await retype('FIIs', '30');
    await userEvent.keyboard('{Control>}s{/Control}');

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('o erro da api volta na barra, com o texto dela, e o rascunho fica', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('A soma dos alvos é 99,99'));
    show(allocation(), { onSave });

    await retype('Ações', '30');
    await retype('FIIs', '30');
    await userEvent.click(screen.getByRole('button', { name: /Salvar estratégia/ }));

    expect(await screen.findByText('A soma dos alvos é 99,99')).toBeInTheDocument();
    expect(field('Ações')).toHaveValue('30');
  });
});

describe('planejar aporte', () => {
  const plan = {
    amount: '4000.00',
    allocated: '4000.00',
    unallocated: '0.00',
    shares: [
      {
        category_id: FIIS,
        name: 'FIIs',
        color_token: 'class.fiis',
        amount: '3000.00',
        deviation_after_pp: '-0.20',
      },
    ],
    max_deviation_before_pp: '-0.90',
    max_deviation_after_pp: '-0.20',
  };

  it('calcula com o valor digitado em formato da api e mostra o plano', async () => {
    const onPlan = vi.fn().mockResolvedValue(plan);
    show(allocation(), { onPlan });

    await userEvent.click(screen.getByRole('button', { name: 'Planejar aporte' }));
    const dialog = screen.getByRole('dialog', { name: 'Planejar aporte' });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Valor do aporte' }),
      '4.000,00',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Calcular' }));

    await waitFor(() => expect(onPlan).toHaveBeenCalledWith('4000.00'));
    const table = await within(dialog).findByRole('table', {
      name: 'Plano de aporte por categoria',
    });
    expect(within(table).getByText('FIIs')).toBeInTheDocument();
    expect(within(dialog).queryByText('Fica em conta')).not.toBeInTheDocument();
  });

  it('valor zero ou texto não calcula', async () => {
    show(allocation());

    await userEvent.click(screen.getByRole('button', { name: 'Planejar aporte' }));
    const dialog = screen.getByRole('dialog', { name: 'Planejar aporte' });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Valor do aporte' }),
      '0',
    );

    expect(within(dialog).getByRole('button', { name: 'Calcular' })).toBeDisabled();
  });

  it('com alteração não salva, avisa que o plano usa o salvo', async () => {
    show(allocation());

    await retype('Ações', '30');
    await userEvent.click(screen.getByRole('button', { name: 'Planejar aporte' }));

    const dialog = screen.getByRole('dialog', { name: 'Planejar aporte' });
    expect(within(dialog).getByText(/usa a estratégia salva/)).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Valor do aporte' }),
      '100',
    );
    expect(within(dialog).getByRole('button', { name: 'Calcular' })).toBeDisabled();
  });
});

describe('estados', () => {
  it('carregando e erro têm tela própria', () => {
    const base = {
      onSave: vi.fn(),
      onSaveRules: vi.fn(),
      onPlan: vi.fn(),
    };

    const { unmount } = render(
      <PreferencesProvider storage={null}>
        <StrategyView
          {...base}
          resource={{ state: { kind: 'loading' }, pending: true, reload: () => {} }}
        />
      </PreferencesProvider>,
    );
    expect(screen.getByText(/Carregando a estratégia/)).toBeInTheDocument();
    unmount();

    render(
      <PreferencesProvider storage={null}>
        <StrategyView
          {...base}
          resource={{
            state: { kind: 'error', error: new Error('A api caiu') },
            pending: false,
            reload: () => {},
          }}
        />
      </PreferencesProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('A api caiu');
  });

  it('carteira sem fechamento diz que a estratégia aparece no primeiro', () => {
    show(allocation({ reference_date: null }));

    expect(screen.getByText('Nenhum fechamento ainda')).toBeInTheDocument();
  });
});

describe('a tela como a rota a monta', () => {
  it('sem carteira escolhida explica que a estratégia é de uma carteira', () => {
    render(
      <PreferencesProvider storage={null}>
        <StrategyScreen portfolioId={null} />
      </PreferencesProvider>,
    );

    expect(screen.getByText('A estratégia é de uma carteira')).toBeInTheDocument();
  });

  it('a carteira que chega depois do primeiro desenho é lida, e não vira resposta vazia', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(allocation()),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const view = (id: string | null) => (
        <PreferencesProvider storage={null}>
          <StrategyScreen portfolioId={id} />
        </PreferencesProvider>
      );
      const { rerender } = render(view(null));
      rerender(view('0191e5a0-0000-7000-8000-00000000c001'));

      expect(await screen.findByText('Distribuição por categoria')).toBeInTheDocument();
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        'portfolio_id=0191e5a0-0000-7000-8000-00000000c001',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
