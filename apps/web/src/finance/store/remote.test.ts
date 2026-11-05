import * as c from '@patrimonio/contracts';
import { describe, expect, it, vi } from 'vitest';

import { centsToDecimal, decimalToCents } from '../api/money_text.js';
import type { FinanceApi } from '../api/finance_api.js';
import { snapshotToData } from '../api/snapshot.js';
import type { RawSnapshot } from '../api/snapshot.js';
import { emptyEntryDraft } from '../domain/entry_ops.js';
import { commands } from './commands.js';
import type { Command } from './commands.js';
import { createRemoteFinanceStore } from './finance_store.js';

const ID = {
  account: '0196a000-0000-7000-8000-000000000001',
  benefit: '0196a000-0000-7000-8000-000000000002',
  card: '0196a000-0000-7000-8000-000000000003',
  food: '0196a000-0000-7000-8000-000000000004',
  salary: '0196a000-0000-7000-8000-000000000005',
  entry: '0196a000-0000-7000-8000-000000000006',
};

const raw = (): RawSnapshot => ({
  today: '2026-10-24',
  categories: [
    {
      id: ID.food,
      name: 'Mercado',
      kind: 'despesa',
      color: 'green',
      archived: false,
      version: 1,
    },
    {
      id: ID.salary,
      name: 'Salário',
      kind: 'receita',
      color: 'blue',
      archived: false,
      version: 1,
    },
  ],
  accounts: [
    {
      id: ID.account,
      name: 'Itaú',
      type: 'corrente',
      institution: null,
      role: 'Principal',
      role_tag: null,
      opening_amount: '1000.00',
      opening_date: '2026-01-01',
      archived: false,
      version: 1,
    },
    {
      id: ID.benefit,
      name: 'VR',
      type: 'corrente',
      institution: null,
      role: 'Refeição',
      role_tag: null,
      opening_amount: '0.00',
      opening_date: '2026-01-01',
      archived: false,
      version: 1,
    },
  ],
  cards: [
    {
      id: ID.card,
      name: 'Nubank',
      last4: '1234',
      pay_account_id: ID.account,
      limit_amount: '5000.00',
      closing_day: 20,
      due_day: 27,
      archived: false,
      version: 1,
    },
  ],
  recurrings: [],
  skips: [{ recurring_id: 'r1', month: '2026-10' }],
  entries: [
    {
      id: ID.entry,
      kind: 'despesa',
      description: 'Feira',
      date: '2026-10-10',
      category_id: ID.food,
      amount: '120.50',
      status: 'lancada',
      recurring_id: null,
      installment: null,
      note: null,
      version: 1,
      payments: [
        {
          source_type: 'conta',
          source_id: ID.account,
          amount: '120.50',
          invoice_month: null,
        },
      ],
    },
  ],
  movements: [],
  card_items: [],
  invoice_payments: [],
});

describe('dinheiro em texto', () => {
  it('converte sem passar por float', () => {
    expect(decimalToCents('1234.50')).toBe(123450);
    expect(decimalToCents('-0.07')).toBe(-7);
    expect(decimalToCents('9')).toBe(900);
    expect(centsToDecimal(123450)).toBe('1234.50');
    expect(centsToDecimal(-7)).toBe('-0.07');
    expect(centsToDecimal(0)).toBe('0.00');
  });
});

describe('foto da API → modelo das telas', () => {
  it('traduz tipos, centavos, origens e skips', () => {
    const data = snapshotToData(raw());
    expect(data.accounts.map((a) => a.type)).toEqual(['conta', 'conta']);
    expect(data.entries[0]).toMatchObject({
      cents: 12050,
      payments: [{ sourceId: ID.account, cents: 12050 }],
    });
    expect(data.cards[0]).toMatchObject({ payerId: ID.account, limitCents: 500000 });
    expect(data.skips).toEqual(['r1:2026-10']);
  });
});

const recorder = () => {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const api: FinanceApi = {
    snapshot: () => Promise.resolve(raw()),
    sync: () => Promise.resolve({}),
    post: (path, body) => (
      calls.push({ method: 'POST', path, body }),
      Promise.resolve({})
    ),
    put: (path, body) => (calls.push({ method: 'PUT', path, body }), Promise.resolve({})),
    del: (path) => (calls.push({ method: 'DELETE', path }), Promise.resolve({})),
  };
  return { api, calls };
};

const play = async (command: Command) => {
  const { api, calls } = recorder();
  const snapshot = raw();
  await command.remote({ api, data: snapshotToData(snapshot), raw: snapshot });
  return calls;
};

describe('corpos das escritas respeitam o contrato da API', () => {
  const today = '2026-10-24';

  it('lançamento à vista e parcelado', async () => {
    const draft = {
      ...emptyEntryDraft(today),
      description: 'Mercado',
      categoryId: ID.food,
      value: '100,00',
      sourceId: ID.card,
      installments: '3',
    };
    const [call] = await play(commands.addEntry(draft, today));
    const body = c.createEntrySchema.shape.body.parse(call?.body);
    expect(body.installments).toBe(3);
    expect(body.payments).toEqual([
      { source_type: 'cartao', source_id: ID.card, amount: '100.00' },
    ]);
  });

  it('lançamento dividido em duas origens', async () => {
    const draft = {
      ...emptyEntryDraft(today),
      description: 'Jantar',
      categoryId: ID.food,
      value: '100,00',
      sourceId: ID.account,
      split: true,
      firstValue: '60,00',
      secondSourceId: ID.benefit,
      secondValue: '40,00',
    };
    const [call] = await play(commands.addEntry(draft, today));
    expect(() => c.createEntrySchema.shape.body.parse(call?.body)).not.toThrow();
  });

  it('conta, cartão e transferência', async () => {
    const [account] = await play(
      commands.addAccount(
        {
          name: 'Nova',
          role: 'Reserva',
          type: 'conta',
          initial: '10,00',
        },
        today,
      ),
    );
    expect(() => c.createAccountSchema.shape.body.parse(account?.body)).not.toThrow();

    const [update] = await play(
      commands.updateAccount(
        ID.account,
        {
          name: 'Itaú PF',
          role: 'Principal',
          type: 'conta',
          initial: '1000,00',
        },
        today,
      ),
    );
    expect(update?.path).toBe(`/accounts/${ID.account}`);
    expect(() => c.accountBody.parse(update?.body)).not.toThrow();

    const [card] = await play(
      commands.addCard({
        name: 'Inter',
        last4: '9876',
        payerId: ID.account,
        limit: '2.000,00',
        closingDay: '10',
        dueDay: '17',
      }),
    );
    expect(() => c.createCardSchema.shape.body.parse(card?.body)).not.toThrow();

    const [transfer] = await play(
      commands.addTransfer(
        {
          fromId: ID.account,
          toId: ID.benefit,
          value: '50,00',
          date: today,
          description: '',
        },
        today,
      ),
    );
    expect(() => c.createTransferSchema.shape.body.parse(transfer?.body)).not.toThrow();
  });

  it('recorrente, categoria, crédito, encargo e pagamento de fatura', async () => {
    const [recurring] = await play(
      commands.addRecurring(
        {
          name: 'Internet',
          kind: 'despesa',
          categoryId: ID.food,
          sourceId: ID.account,
          split: false,
          secondSourceId: '',
          coversUpTo: '',
          day: '10',
          mode: 'automatico',
          value: '99,90',
          active: true,
        },
        today,
      ),
    );
    expect(() => c.createRecurringSchema.shape.body.parse(recurring?.body)).not.toThrow();

    const [category] = await play(
      commands.addCategory({ name: 'Lazer', kind: 'despesa', color: 'violet' }),
    );
    expect(() =>
      c.createFinCategorySchema.shape.body.parse(category?.body),
    ).not.toThrow();

    const [credit] = await play(
      commands.addCredit(ID.card, '2026-11', {
        subtype: 'estorno',
        description: 'Estorno',
        date: today,
        categoryId: ID.food,
        value: '10,00',
      }),
    );
    expect(() => c.cardItemBody.parse(credit?.body)).not.toThrow();

    const [charge] = await play(
      commands.addCharge(ID.card, '2026-11', {
        subtype: 'juros',
        date: today,
        value: '3,00',
        categoryId: ID.food,
      }),
    );
    expect(() => c.cardItemBody.parse(charge?.body)).not.toThrow();
  });

  it('excluir, recategorizar e mover vão lançamento a lançamento', async () => {
    expect(await play(commands.deleteEntries([ID.entry]))).toEqual([
      { method: 'DELETE', path: `/entries/${ID.entry}` },
    ]);
    const [recat] = await play(commands.recategorize([ID.entry], ID.food));
    expect(recat).toBeUndefined(); // já está nesta categoria
    const [move] = await play(commands.moveAccount([ID.entry], ID.benefit));
    expect(() => c.entryBody.parse(move?.body)).not.toThrow();
    expect(move?.body).toMatchObject({
      payments: [{ source_type: 'conta', source_id: ID.benefit, amount: '120.50' }],
    });
  });
});

describe('store remota', () => {
  it('carrega a foto, executa a ação e relê', async () => {
    const { api, calls } = recorder();
    const snapshot = vi.fn(api.snapshot);
    const store = createRemoteFinanceStore({ ...api, snapshot });
    expect(store.status().phase).toBe('loading');
    store.start();
    await vi.waitFor(() => expect(store.status().phase).toBe('ready'));
    expect(store.get().entries).toHaveLength(1);

    const ok = await store.run(commands.deleteEntries([ID.entry]));
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it('uma escrita que falha avisa e relê a foto', async () => {
    const { api } = recorder();
    const snapshot = vi.fn(api.snapshot);
    const store = createRemoteFinanceStore({
      ...api,
      snapshot,
      del: () => Promise.reject(new Error('Categoria em uso')),
    });
    store.start();
    await vi.waitFor(() => expect(store.status().phase).toBe('ready'));

    const ok = await store.run(commands.deleteEntries([ID.entry]));
    expect(ok).toBe(false);
    expect(store.status().error).toBe('Categoria em uso');
    expect(snapshot).toHaveBeenCalledTimes(2);
    store.dismissError();
    expect(store.status().error).toBeNull();
  });

  it('falha na primeira leitura vira erro de carga', async () => {
    const { api } = recorder();
    const store = createRemoteFinanceStore({
      ...api,
      snapshot: () => Promise.reject(new Error('fora do ar')),
    });
    store.start();
    await vi.waitFor(() => expect(store.status().phase).toBe('error'));
    expect(store.status().error).toBe('fora do ar');
  });
});
