import { describe, expect, it } from 'vitest';

import { currentMonth } from '../lib/period.js';
import { EMPTY_FILTERS } from '../lib/filters.js';
import { sum } from '../lib/money.js';
import { accountBalance, accountLines, accountsOverview, statement } from './accounts.js';
import { addCredit } from './card_item_ops.js';
import {
  cardSummary,
  invoiceLines,
  invoiceTotals,
  openInvoicesTotal,
  upcomingInvoices,
  vigenteKey,
  findCard,
} from './cards.js';
import { categoryUsage } from './categories.js';
import { deleteCategory } from './category_ops.js';
import { addEntry, draftOfEntry, emptyEntryDraft, launchEntry } from './entry_ops.js';
import type { EntryDraft } from './entry_ops.js';
import { payInvoice } from './invoice_ops.js';
import { indicators, queryEntries } from './ledger.js';
import { groupEntries } from './ledger_groups.js';
import { categoryBreakdown, monthResult } from './overview.js';
import { setRecurringActive, syncRecurring } from './recurring.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';
import { addTransfer } from './transfer_ops.js';
import type { FinanceData } from './types.js';

/**
 * FIN-704 · RN-70: o mesmo valor aparece igual em qualquer tela. Esta suíte lê
 * os mesmos números por caminhos diferentes (os de cada tela) e falha quando
 * qualquer par diverge. Os cenários CE-01 a CE-09 fazem parte dela.
 */

const TODAY = SEED_REFERENCE_DATE;
const OCTOBER = currentMonth(TODAY);
const base = seedData();

/** Todos os números que as telas mostram, lidos pelo caminho de cada tela. */
const screens = (data: FinanceData, today = TODAY) => {
  const range = currentMonth(today);
  const overview = monthResult(data, range, today);
  const ledger = indicators(queryEntries(data, '', EMPTY_FILTERS), range);
  const accounts = accountsOverview(data, range, today, false);
  const summaries = data.cards.map((card) => cardSummary(data, card, today));
  return { range, overview, ledger, accounts, summaries };
};

const expectConsistent = (data: FinanceData, today = TODAY): void => {
  const { range, overview, ledger, accounts, summaries } = screens(data, today);

  // Receitas, Despesas e Saldo do mês: Visão geral × Lançamentos
  expect(overview.receitas).toEqual(ledger.receitas);
  expect(overview.despesas).toEqual(ledger.despesas);
  expect(overview.saldo).toBe(ledger.saldo);

  // Em contas: Visão geral × Contas × soma dos Extratos
  expect(overview.accountsCents).toBe(accounts.totalBalance);
  const closings = data.accounts
    .filter((a) => a.type === 'conta' && a.archived !== true)
    .map((a) => statement(data, a.id, range, today).closing);
  expect(sum(closings)).toBe(accounts.totalBalance);

  // Saldo atual: Contas × Extrato
  for (const row of accounts.accounts) {
    expect(accountBalance(data, row.account.id, today)).toBe(row.balance);
    expect(statement(data, row.account.id, range, today).closing).toBe(row.balance);
  }

  // Faturas abertas: Visão geral × Cartões
  expect(overview.invoicesCents).toBe(openInvoicesTotal(summaries));

  // Total da fatura: Cartões × Fatura × Próximas faturas
  const upcoming = upcomingInvoices(data, today);
  for (const item of summaries) {
    const key = vigenteKey(data, item.card, today);
    const fromInvoice = invoiceTotals(invoiceLines(data, item.card, key)).total;
    expect(item.usedCents).toBe(fromInvoice);
    const row = upcoming.find((r) => r.key === key);
    const cell = row?.cells.find((c) => c.cardId === item.card.id);
    expect(cell?.cents ?? 0).toBe(item.usedCents);
  }

  // Total por categoria: Visão geral × Categorias × Lançamentos agrupado
  const breakdown = categoryBreakdown(data, range);
  const grouped = groupEntries(
    'categoria',
    queryEntries(data, '', EMPTY_FILTERS),
    range,
    data,
  );
  for (const row of breakdown.rows) {
    expect(categoryUsage(data.entries, row.categoryId, today).total).toBe(row.cents);
    const group = grouped.find(
      (g) =>
        g.id.includes(row.categoryId) ||
        g.title === data.categories.find((c) => c.id === row.categoryId)?.name,
    );
    expect(group?.summary.despesas).toBe(row.cents);
  }
  expect(breakdown.total).toBe(ledger.despesas.cents);
};

describe('consistência entre telas (FIN-704, RN-70)', () => {
  it('as pranchas de 24/10/2026', () => {
    expectConsistent(base);
    const { overview, accounts } = screens(base);
    expect(overview.receitas.cents).toBe(1635000);
    expect(overview.despesas.cents).toBe(947810);
    expect(overview.saldo).toBe(687190);
    expect(accounts.totalBalance).toBe(1258385);
    expect(overview.invoicesCents).toBe(542227);
  });
});

const draftOf = (patch: Partial<EntryDraft>): EntryDraft => ({
  ...emptyEntryDraft(TODAY),
  ...patch,
});
const balance = (data: FinanceData, id: string) => accountBalance(data, id, TODAY);

describe('CE-01 · recorrente automático chega no dia', () => {
  it('vira lançado sozinho, entra em Receitas, no extrato com a etiqueta e no saldo', () => {
    const before = {
      ...base,
      entries: base.entries.map((entry) =>
        entry.id === 'l-salario' ? { ...entry, status: 'prevista' as const } : entry,
      ),
    };
    const after = syncRecurring(before, '2026-10-05');
    const salary = after.entries.find((e) => e.id === 'l-salario');
    expect(salary?.status).toBe('lancada');
    expect(salary?.cents).toBe(1420000);
    const line = accountLines(after, 'itau-corrente', '2026-10-05').find(
      (l) => l.description === salary?.description,
    );
    expect(line?.tags).toContain('recorrente');
    expect(
      accountBalance(after, 'itau-corrente', '2026-10-05') -
        accountBalance(before, 'itau-corrente', '2026-10-05'),
    ).toBe(1420000);
    expectConsistent(after, '2026-10-05');
  });
});

describe('CE-02 · lançar o previsto manual com o valor real', () => {
  const entry = base.entries.find((e) => e.id === 'l-investimento-fim')!;
  const launched = launchEntry(
    base,
    'l-investimento-fim',
    { ...draftOfEntry(entry, TODAY), value: '2300,00', date: '2026-10-24' },
    TODAY,
  );
  it('Despesas, Saldo, Ainda a lançar, Itaú, Em contas e categoria', () => {
    const { overview, ledger } = screens(launched);
    expect(overview.despesas.cents).toBe(1177810);
    expect(overview.saldo).toBe(457190);
    expect(ledger.aLancar.cents).toBe(472190);
    expect(ledger.aLancar.count).toBe(2);
    expect(balance(launched, 'itau-corrente')).toBe(81280);
    expect(overview.accountsCents).toBe(1028385);
    expect(categoryUsage(launched.entries, 'investimento', TODAY).total).toBe(680000);
    expect(launched.recurrings.find((r) => r.id === 'r-investimento-fim')?.cents).toBe(
      215000,
    );
    expectConsistent(launched);
  });
});

describe('CE-03 · despesa dividida entre duas origens', () => {
  const draft = draftOf({
    description: 'Conta de água',
    categoryId: 'moradia',
    value: '200,00',
    sourceId: 'flex',
    split: true,
    firstValue: '120,00',
    secondSourceId: 'itau-corrente',
    secondValue: '80,00',
  });
  const next = addEntry(base, draft, TODAY);
  it('Despesas sobe uma vez; Itaú e Flex descem a parte de cada um; Em contas desce o valor todo', () => {
    const before = screens(base);
    const after = screens(next);
    expect(after.overview.despesas.cents - before.overview.despesas.cents).toBe(20000);
    expect(balance(next, 'itau-corrente')).toBe(303280);
    expect(balance(next, 'flex')).toBe(7830);
    expect(before.overview.accountsCents - after.overview.accountsCents).toBe(20000);
    expectConsistent(next);
  });
  it('partes que não fecham não salvam', () => {
    const bad = addEntry(base, { ...draft, secondValue: '70,00' }, TODAY);
    expect(bad).toBe(base);
  });
});

describe('CE-04 · pagar a fatura fechada do Itaú Visa', () => {
  const paid = payInvoice(base, 'itau-visa', '2026-10', '2026-10-24', TODAY);
  it('conta, extrato, faturas abertas e próximas faturas', () => {
    expect(balance(paid, 'itau-corrente')).toBe(171270);
    expect(screens(paid).overview.accountsCents).toBe(1118375);
    expect(
      accountLines(paid, 'itau-corrente', TODAY).some(
        (l) => l.tags[0] === 'fatura' && l.cents === -140010,
      ),
    ).toBe(true);
    expect(screens(paid).overview.despesas.cents).toBe(
      screens(base).overview.despesas.cents,
    );
    const visa = screens(paid).summaries.find((s) => s.card.id === 'itau-visa');
    expect(visa?.invoice.key).toBe('2026-11');
    expect(visa?.usedCents).toBe(82171);
    expect(screens(paid).overview.invoicesCents).toBe(484388);
    const october = upcomingInvoices(paid, TODAY).find((r) => r.key === '2026-10');
    expect(october?.cells.find((c) => c.cardId === 'itau-visa')?.cents).toBeNull();
    expect(october?.total).toBe(54000);
    expectConsistent(paid);
  });
});

describe('CE-05 · cashback na fatura de nov/2026 do Nubank', () => {
  const next = addCredit(base, 'nubank-master', '2026-11', {
    subtype: 'cashback',
    description: 'Cashback',
    date: '2026-10-24',
    categoryId: 'mercado',
    value: '15,00',
  });
  it('total, limite usado, disponível e faturas abertas; receitas não mudam', () => {
    const card = findCard(next, 'nubank-master')!;
    const summary = cardSummary(next, card, TODAY);
    expect(summary.usedCents).toBe(346717);
    expect(summary.usedPercent).toBe(61.3);
    expect(summary.availableCents).toBe(219283);
    expect(screens(next).overview.invoicesCents).toBe(540727);
    expect(screens(next).overview.receitas).toEqual(screens(base).overview.receitas);
    expectConsistent(next);
  });
});

describe('CE-06 · transferência entre contas', () => {
  const next = addTransfer(
    base,
    {
      fromId: 'itau-corrente',
      toId: 'nubank-conta',
      value: '500,00',
      date: '2026-10-24',
      description: '',
    },
    TODAY,
  );
  it('move entre as contas e não muda o total nem receitas e despesas', () => {
    expect(balance(next, 'itau-corrente')).toBe(261280);
    expect(balance(next, 'nubank-conta')).toBe(892035);
    expect(screens(next).overview.accountsCents).toBe(1258385);
    expect(screens(next).overview.receitas).toEqual(screens(base).overview.receitas);
    expect(screens(next).overview.despesas).toEqual(screens(base).overview.despesas);
    expectConsistent(next);
  });
});

describe('CE-07 · R$ 3.000,00 em 6 parcelas no Nubank Mastercard', () => {
  const draft = draftOf({
    description: 'Sofá',
    categoryId: 'moradia',
    value: '3000,00',
    sourceId: 'nubank-master',
    date: '2026-10-20',
    installments: '6',
  });
  const next = addEntry(base, draft, TODAY);
  it('parcela 1 em nov, limite em âmbar, parcelas seguintes e Despesas', () => {
    const card = findCard(next, 'nubank-master')!;
    const summary = cardSummary(next, card, TODAY);
    expect(summary.usedCents).toBe(398217);
    expect(summary.usedPercent).toBe(70.4);
    expect(summary.availableCents).toBe(167783);
    const dec = invoiceLines(next, card, '2026-12');
    expect(invoiceTotals(dec).total).toBe(179900);
    expect(
      screens(next).overview.despesas.cents - screens(base).overview.despesas.cents,
    ).toBe(50000);
    expect(invoiceTotals(invoiceLines(next, card, '2027-04')).total).toBe(50000);
    expectConsistent(next);
  });
  it('feita em 30/10, a parcela 1 cai em dezembro', () => {
    const late = addEntry(base, { ...draft, date: '2026-10-30' }, '2026-10-30');
    const card = findCard(late, 'nubank-master')!;
    expect(
      invoiceLines(late, card, '2026-12').some((l) => l.description === 'Sofá'),
    ).toBe(true);
    expect(
      invoiceLines(late, card, '2026-11').some((l) => l.description === 'Sofá'),
    ).toBe(false);
  });
});

describe('CE-08 · desativar o recorrente Spotify', () => {
  const next = setRecurringActive(base, 'r-spotify', false, TODAY);
  it('o previsto some, Ainda a lançar cai e a contagem de ativas muda', () => {
    expect(next.entries.some((e) => e.id === 'l-spotify')).toBe(false);
    expect(screens(next).ledger.aLancar.cents).toBe(685000);
    expect(next.entries.some((e) => e.id === 'l-netflix')).toBe(true);
    const active = next.recurrings.filter((r) => r.active).length;
    const paused = next.recurrings.filter((r) => !r.active).length;
    expect([active, paused]).toEqual([14, 2]);
    const november = syncRecurring(next, '2026-11-01');
    expect(
      november.entries.some(
        (e) => e.recurringId === 'r-spotify' && e.date.startsWith('2026-11'),
      ),
    ).toBe(false);
    expectConsistent(next);
  });
});

describe('CE-09 · excluir Moradia com reatribuição para Mercado', () => {
  const next = deleteCategory(base, 'moradia', 'mercado');
  it('lançamentos e recorrentes vão para Mercado; Despesas não muda', () => {
    expect(next.categories.some((c) => c.id === 'moradia')).toBe(false);
    expect(next.recurrings.some((r) => r.categoryId === 'moradia')).toBe(false);
    expect(categoryUsage(next.entries, 'mercado', TODAY).total).toBe(356240);
    expect(screens(next).overview.despesas.cents).toBe(947810);
    const rows = categoryBreakdown(next, OCTOBER).rows.map((r) => r.categoryId);
    expect(rows).not.toContain('moradia');
    expect(rows).toContain('mercado');
    expectConsistent(next);
  });
});
