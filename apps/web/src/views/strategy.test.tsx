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
    recalc_status: 'idle',
  },
  rules: {
    tolerance_pp: '3.00',
    reviewed_on: '2026-07-09',
    benchmark: { value: 'IPCA+6', name: 'IPCA + 6%' },
  },
  strategy_defined: true,
  composition: {
    total: '3000.00',
    nodes: [
      line('rv', 'Renda variável', '60.00', '60.00', {
        level: 'group',
        children: [
          line(ACOES, 'Ações', '35.30', null) as never,
          line(FIIS, 'FIIs', '24.70', null) as never,
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

/** Estratégia salva por categoria, de antes de o alvo ser da classe. */
const legacy = (): AllocationResource => {
  const base = allocation();
  const group = base.composition.nodes[0];
  if (group === undefined) throw new Error('fixture');

  return {
    ...base,
    composition: {
      ...base.composition,
      nodes: [
        {
          ...group,
          children: [
            line(ACOES, 'Ações', '35.30', '35.00') as never,
            line(FIIS, 'FIIs', '24.70', '25.00') as never,
          ],
        },
        ...base.composition.nodes.slice(1),
      ],
    },
  };
};

const ready = (value: AllocationResource): Resource<AllocationResource> => ({
  state: { kind: 'ready', value },
  pending: false,
  reload: () => {},
});

const show = (
  value: AllocationResource,
  props: Partial<StrategyViewProps> = {},
): { onSave: ReturnType<typeof vi.fn> } => {
  const onSave = vi.fn().mockResolvedValue(undefined);

  render(
    <PreferencesProvider storage={null}>
      <StrategyView
        resource={ready(value)}
        onSave={onSave}
        onPlan={vi.fn().mockResolvedValue(null)}
        {...props}
      />
    </PreferencesProvider>,
  );

  return { onSave };
};

const field = (name: string): HTMLInputElement =>
  screen.getByRole('textbox', { name: `Alvo de ${name}` });

const retype = async (name: string, text: string): Promise<void> => {
  const input = field(name);
  await userEvent.clear(input);
  if (text !== '') await userEvent.type(input, text);
};

describe('as regras', () => {
  it('mostra a tolerância e o benchmark', () => {
    show(allocation());

    expect(screen.getByText('± 3 pp')).toBeInTheDocument();
    expect(screen.getByText('IPCA + 6%')).toBeInTheDocument();
  });
});

describe('a tabela', () => {
  it('o alvo é da classe, e o total fecha 100%', () => {
    show(allocation());

    expect(field('Renda variável')).toHaveValue('60');
    expect(field('Caixa')).toHaveValue('40');
    expect(screen.getByText('✓ 100%')).toBeInTheDocument();
  });

  it('expandir a classe mostra as categorias dela, sem campo de alvo', async () => {
    show(allocation());

    expect(screen.queryByRole('row', { name: /^Ações/ })).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Expandir Renda variável' }),
    );

    expect(screen.getByRole('row', { name: /Ações/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Alvo de Ações' }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Recolher Renda variável' }),
    );

    expect(screen.queryByRole('row', { name: /^Ações/ })).not.toBeInTheDocument();
    expect(field('Caixa')).toBeInTheDocument();
  });

  it('alvo salvo por categoria aparece como soma na classe, e digitar nela passa o alvo para a classe', async () => {
    show(legacy());

    expect(field('Renda variável')).toHaveValue('60');

    await retype('Renda variável', '50');

    const bar = screen.getByRole('region', { name: 'Alterações não salvas' });
    expect(within(bar).getByText(/Soma 90% · faltam 10 pp/)).toBeInTheDocument();
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

    await retype('Renda variável', '50');

    const bar = screen.getByRole('region', { name: 'Alterações não salvas' });
    expect(
      within(bar).getByText(/Soma 90% · faltam 10 pp para salvar/),
    ).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Salvar estratégia/ })).toBeDisabled();
  });

  it('trocar 60/40 por 50/50 fecha a soma e libera o salvar', async () => {
    show(allocation());

    await retype('Renda variável', '50');
    await retype('Caixa', '50');

    const bar = screen.getByRole('region', { name: 'Alterações não salvas' });
    expect(within(bar).getByText('2 alterações não salvas')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Salvar estratégia/ })).toBeEnabled();
  });

  it('envia só o que tem alvo, com ponto e duas casas', async () => {
    const { onSave } = show(allocation());

    await retype('Renda variável', '30,5');
    await retype('Caixa', '69,5');
    await userEvent.click(screen.getByRole('button', { name: /Salvar estratégia/ }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        targets: [
          { category_id: 'rv', target_pct: '30.50' },
          { category_id: CAIXA, target_pct: '69.50' },
        ],
      }),
    );
  });

  it('campo inválido se marca e trava, sem adivinhar o número', async () => {
    show(allocation());

    await retype('Renda variável', 'abc');

    expect(field('Renda variável')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Corrija 1 campo para salvar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar estratégia/ })).toBeDisabled();
  });

  it('descartar volta ao salvo e some com a barra', async () => {
    show(allocation());

    await retype('Renda variável', '10');
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(field('Renda variável')).toHaveValue('60');
    expect(screen.queryByRole('region', { name: 'Alterações não salvas' })).toBeNull();
  });

  it('digitar de volta o valor salvo desfaz a alteração', async () => {
    show(allocation());

    await retype('Renda variável', '10');
    await retype('Renda variável', '60');

    expect(screen.queryByRole('region', { name: 'Alterações não salvas' })).toBeNull();
  });

  it('⌘S salva sem sair do campo', async () => {
    const { onSave } = show(allocation());

    await retype('Renda variável', '50');
    await retype('Caixa', '50');
    await userEvent.keyboard('{Control>}s{/Control}');

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('o erro da api volta na barra, com o texto dela, e o rascunho fica', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('A soma dos alvos é 99,99'));
    show(allocation(), { onSave });

    await retype('Renda variável', '50');
    await retype('Caixa', '50');
    await userEvent.click(screen.getByRole('button', { name: /Salvar estratégia/ }));

    expect(await screen.findByText('A soma dos alvos é 99,99')).toBeInTheDocument();
    expect(field('Renda variável')).toHaveValue('50');
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
      name: 'Plano de aporte por classe',
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

    await retype('Renda variável', '50');
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

  it('carteira sem consolidação diz que a estratégia aparece no primeiro', () => {
    show(allocation({ reference_date: null }));

    expect(screen.getByText('Carteira ainda não consolidada')).toBeInTheDocument();
  });
});

describe('a tela como a rota a monta', () => {
  it('a carteira que chega depois do primeiro desenho é lida, e não vira resposta vazia', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(allocation()),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const view = (id: string) => (
        <PreferencesProvider storage={null}>
          <StrategyScreen portfolioId={id} />
        </PreferencesProvider>
      );
      const { rerender } = render(view('0191e5a0-0000-7000-8000-00000000c000'));
      rerender(view('0191e5a0-0000-7000-8000-00000000c001'));

      expect(await screen.findByText('Distribuição por classe')).toBeInTheDocument();
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
        'portfolio_id=0191e5a0-0000-7000-8000-00000000c001',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
