import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { NewEntryModal } from './new_entry_modal.js';

const categories = {
  categories: [
    { id: 'c-d', name: 'Mercado', kind: 'despesa' },
    { id: 'c-r', name: 'Salário', kind: 'receita' },
  ],
};
const effect = {
  effect: {
    accounts: [{ account_id: 'a1', name: 'Nubank', before: '100.00', after: '87.50' }],
    months: [],
    warnings: [],
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('NewEntryModal', () => {
  it('salva com Idempotency-Key e mostra o efeito', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const body = url.includes('categories')
          ? categories
          : url.includes('preview')
            ? effect
            : { entries: [] };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const onSaved = vi.fn();
    render(
      <PreferencesProvider>
        <NewEntryModal
          today="2026-11-13"
          accounts={[{ id: 'a1', name: 'Nubank' }]}
          context={{ accountId: 'a1' }}
          onSaved={onSaved}
          onClose={() => undefined}
        />
      </PreferencesProvider>,
    );

    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Feira' } });
    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '12,50' } });
    await waitFor(() =>
      expect(
        screen.getByLabelText('Categoria').querySelectorAll('option').length,
      ).toBeGreaterThan(1),
    );
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'c-d' } });

    await waitFor(() => expect(screen.getByText(/Saldo · Nubank/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Lançar/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const post = calls.find(
      (c) => c.init?.method === 'POST' && !c.url.includes('preview'),
    );
    const headers = post?.init?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({
      kind: 'despesa',
      amount: '12.50',
      category_id: 'c-d',
    });
  });

  it('recusa data futura inline e não grava', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(categories), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <PreferencesProvider>
        <NewEntryModal
          today="2026-11-13"
          accounts={[{ id: 'a1', name: 'Nubank' }]}
          onSaved={() => undefined}
          onClose={() => undefined}
        />
      </PreferencesProvider>,
    );
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: /Lançar/ }));
    await waitFor(() =>
      expect(screen.getByText(/Data futura não é lançamento/)).toBeTruthy(),
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('transferência grava em /transfers sem categoria', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify(url.includes('categories') ? categories : effect),
          {
            status: 200,
          },
        );
      }),
    );
    const onSaved = vi.fn();
    render(
      <PreferencesProvider>
        <NewEntryModal
          today="2026-11-13"
          accounts={[
            { id: 'a1', name: 'Nubank' },
            { id: 'a2', name: 'Itaú' },
          ]}
          context={{ accountId: 'a1' }}
          initialKind="TRANSFERENCIA"
          onSaved={onSaved}
          onClose={() => undefined}
        />
      </PreferencesProvider>,
    );
    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('Para'), { target: { value: 'a2' } });
    fireEvent.click(screen.getByRole('button', { name: /Lançar/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = calls.find(
      (c) => c.init?.method === 'POST' && !c.url.includes('preview'),
    );
    expect(post?.url).toBe('/api/finance/transfers');
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({
      from_account_id: 'a1',
      to_account_id: 'a2',
      amount: '300',
    });
  });
});
