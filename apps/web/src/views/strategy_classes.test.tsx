import type { CategoryResource } from '@patrimonio/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClassesDialog, groupClasses } from './strategy_classes.js';

const category = (
  id: string,
  name: string,
  parent: string | null,
  order: number,
): CategoryResource => ({
  id,
  parent_id: parent,
  name,
  color_token: 'class.acoes',
  auto_rule: null,
  sort_order: order,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const ACOES = '019b0000-0000-7000-8000-000000000001';
const FIIS = '019b0000-0000-7000-8000-000000000002';
const ETF = '019b0000-0000-7000-8000-000000000003';

const CATALOG = [
  category(ACOES, 'Ações', null, 10),
  category(FIIS, 'Fundos imobiliários', null, 20),
  category(ETF, 'ETF de FIIs', ACOES, 11),
];

describe('groupClasses', () => {
  it('as classes são as categorias de primeiro nível, cada uma com as que estão dentro', () => {
    const groups = groupClasses(CATALOG);

    expect(groups.map((group) => group.head.name)).toEqual([
      'Ações',
      'Fundos imobiliários',
    ]);
    expect(groups[0]?.members.map((member) => member.name)).toEqual(['ETF de FIIs']);
    expect(groups[1]?.members).toEqual([]);
  });
});

describe('o diálogo de classes', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ categories: CATALOG }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('mover a categoria para outra classe pede o PATCH com o id da classe nova', async () => {
    const fetchMock = stub();
    const onChanged = vi.fn();
    render(<ClassesDialog onClose={() => {}} onChanged={onChanged} />);

    const select = await screen.findByRole('combobox', { name: 'Classe de ETF de FIIs' });
    await userEvent.selectOptions(select, FIIS);

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(String(call?.[0])).toContain(`/api/categories/${ETF}`);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ parent_id: FIIS });
  });

  it('classe com categorias dentro não pode ser excluída, e a vazia pode', async () => {
    stub();
    render(<ClassesDialog onClose={() => {}} onChanged={() => {}} />);

    const cheia = await screen.findByRole('button', { name: 'Excluir a classe Ações' });
    const vazia = screen.getByRole('button', {
      name: 'Excluir a classe Fundos imobiliários',
    });

    expect(cheia).toBeDisabled();
    expect(vazia).toBeEnabled();
    expect(
      within(screen.getByRole('dialog')).getByText(/Classe vazia/),
    ).toBeInTheDocument();
  });

  it('criar classe manda o nome e uma cor do design system', async () => {
    const fetchMock = stub();
    render(<ClassesDialog onClose={() => {}} onChanged={() => {}} />);

    await userEvent.type(await screen.findByLabelText('Nome da nova classe'), 'Cripto');
    await userEvent.click(screen.getByRole('button', { name: 'Criar classe' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      name: 'Cripto',
      color_token: 'class.outros',
    });
  });
});
