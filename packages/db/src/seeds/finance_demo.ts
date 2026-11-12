import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FinanceChanges } from '@patrimonio/application';
import type { FinSnapshot } from '@patrimonio/domain';
import { v5 as uuidv5 } from 'uuid';

import type { Sql } from '../postgresql.js';
import { createFinanceRepository } from '../repositories/finance.repository.js';

/** Namespace fixo: o mesmo id de semente vira sempre o mesmo UUID. */
const NAMESPACE = '6f1d5c3e-0b6a-5e55-9a52-0b8a5b1e7a01';

export type FinanceDemo = {
  readonly reference_date: string;
  readonly snapshot: FinSnapshot;
};

/** Compilado, o JSON continua em `src/seeds`: mesmo caminho que o calendário usa. */
const demoPath = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  return here.includes(join('dist', 'seeds'))
    ? join(here, '..', '..', 'src', 'seeds', 'finance_demo.json')
    : join(here, 'finance_demo.json');
};

export const readFinanceDemo = (): FinanceDemo =>
  JSON.parse(readFileSync(demoPath(), 'utf8')) as FinanceDemo;

const uid = (seedId: string): string => uuidv5(seedId, NAMESPACE);
const maybe = (seedId: string | null): string | null =>
  seedId === null ? null : uid(seedId);

/** Troca os ids legíveis da semente pelos UUIDs determinísticos. */
export const withUuids = (data: FinSnapshot): FinSnapshot => ({
  categories: data.categories.map((r) => ({ ...r, id: uid(r.id) })),
  accounts: data.accounts.map((r) => ({ ...r, id: uid(r.id) })),
  cards: data.cards.map((r) => ({
    ...r,
    id: uid(r.id),
    pay_account_id: uid(r.pay_account_id),
  })),
  recurrings: data.recurrings.map((r) => ({
    ...r,
    id: uid(r.id),
    category_id: uid(r.category_id),
    source: { ...r.source, id: uid(r.source.id) },
    second_source:
      r.second_source === null
        ? null
        : { ...r.second_source, id: uid(r.second_source.id) },
  })),
  skips: data.skips.map((r) => ({ ...r, recurring_id: uid(r.recurring_id) })),
  entries: data.entries.map((r) => ({
    ...r,
    id: uid(r.id),
    category_id: uid(r.category_id),
    recurring_id: maybe(r.recurring_id),
    installment:
      r.installment === null
        ? null
        : { ...r.installment, group_id: uid(r.installment.group_id) },
    payments: r.payments.map((p) => ({ ...p, source_id: uid(p.source_id) })),
  })),
  movements: data.movements.map((r) => ({
    ...r,
    id: uid(r.id),
    account_id: uid(r.account_id),
    transfer_id: maybe(r.transfer_id),
  })),
  card_items: data.card_items.map((r) => ({
    ...r,
    id: uid(r.id),
    card_id: uid(r.card_id),
    category_id: maybe(r.category_id),
    installment:
      r.installment === null
        ? null
        : { ...r.installment, group_id: uid(r.installment.group_id) },
  })),
  invoice_payments: data.invoice_payments.map((r) => ({
    ...r,
    id: uid(r.id),
    card_id: uid(r.card_id),
    account_id: uid(r.account_id),
  })),
});

const upserts = <T>(rows: readonly T[]) => ({ upserts: rows, deletes: [] as string[] });

/**
 * Linha que sobreviveu à remoção (uma conta de demonstração que ganhou
 * lançamento real) já tem versão no banco: a semente a reescreve nessa versão,
 * senão a trava otimista a trataria como edição velha.
 */
const alignVersions = async <T extends { id: string; version: number }>(
  tx: Sql,
  table: string,
  rows: readonly T[],
): Promise<T[]> => {
  if (rows.length === 0) return [];
  const current = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((row) => row.id);
    const found = await tx<
      { id: string; version: number }[]
    >`SELECT id, version FROM ${tx(table)} WHERE id IN ${tx(ids)}`;
    for (const row of found) current.set(row.id, row.version);
  }
  return rows.map((row) => ({ ...row, version: current.get(row.id) ?? row.version }));
};

const DEMO_TABLES: readonly [string, (data: FinSnapshot) => readonly { id: string }[]][] =
  [
    ['fin_category', (d) => d.categories],
    ['fin_account', (d) => d.accounts],
    ['fin_card', (d) => d.cards],
    ['fin_recurring', (d) => d.recurrings],
    ['fin_entry', (d) => d.entries],
    ['fin_movement', (d) => d.movements],
    ['fin_card_item', (d) => d.card_items],
    ['fin_invoice_payment', (d) => d.invoice_payments],
  ];

/**
 * Carrega a demonstração de Finanças com `is_demo = TRUE`. Repetível: o que já
 * existe com o mesmo id é atualizado, não duplicado.
 */
export const loadFinanceDemo = async (sql: Sql): Promise<number> => {
  const data = withUuids(readFinanceDemo().snapshot);

  await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Sql;
    // Demonstração anterior sai antes; o que sobreviveu à remoção é reescrito.
    await removeFinanceDemo(tx);
    const changes = {
      categories: upserts(await alignVersions(tx, 'fin_category', data.categories)),
      accounts: upserts(await alignVersions(tx, 'fin_account', data.accounts)),
      cards: upserts(await alignVersions(tx, 'fin_card', data.cards)),
      recurrings: upserts(await alignVersions(tx, 'fin_recurring', data.recurrings)),
      skips: upserts(data.skips),
      entries: upserts(await alignVersions(tx, 'fin_entry', data.entries)),
      movements: upserts(data.movements),
      card_items: upserts(await alignVersions(tx, 'fin_card_item', data.card_items)),
      invoice_payments: upserts(data.invoice_payments),
    } as FinanceChanges;
    const saved = await createFinanceRepository(tx).persist(changes);
    if (saved.isFailure()) throw saved.value;
    for (const [table, rows] of DEMO_TABLES) {
      const ids = rows(data).map((r) => r.id);
      if (ids.length > 0)
        await tx`UPDATE ${tx(table)} SET is_demo = TRUE WHERE id IN ${tx(ids)}`;
    }
    const recurrings = data.recurrings.map((r) => r.id);
    if (recurrings.length > 0) {
      await tx`UPDATE fin_recurring_skip SET is_demo = TRUE WHERE recurring_id IN ${tx(recurrings)}`;
    }
    const entries = data.entries.map((r) => r.id);
    for (let i = 0; i < entries.length; i += 500) {
      await tx`UPDATE fin_entry_payment SET is_demo = TRUE WHERE entry_id IN ${tx(entries.slice(i, i + 500))}`;
    }
  });

  return data.entries.length;
};

export type RemovedFinanceDemo = {
  readonly entries: number;
  readonly movements: number;
  readonly card_items: number;
  readonly invoice_payments: number;
  readonly recurrings: number;
  readonly cards: number;
  readonly accounts: number;
  readonly categories: number;
  readonly kept: number;
};

/**
 * Remove a demonstração de Finanças na ordem das chaves estrangeiras. O que a
 * pessoa criou depois — lançamento real numa categoria ou conta de
 * demonstração — não é apagado: a categoria ou a conta deixa de ser demo.
 */
export const removeFinanceDemo = async (sql: Sql): Promise<RemovedFinanceDemo> => {
  const kept =
    (
      await sql<{ id: string }[]>`
      UPDATE fin_category SET is_demo = FALSE
       WHERE is_demo AND (
         id IN (SELECT category_id FROM fin_entry WHERE NOT is_demo)
         OR id IN (SELECT category_id FROM fin_recurring WHERE NOT is_demo)
         OR id IN (SELECT category_id FROM fin_card_item WHERE NOT is_demo AND category_id IS NOT NULL))
      RETURNING id`
    ).length +
    (
      await sql<{ id: string }[]>`
      UPDATE fin_account SET is_demo = FALSE
       WHERE is_demo AND (
         id IN (SELECT source_id FROM fin_entry_payment WHERE NOT is_demo AND source_type = 'CONTA')
         OR id IN (SELECT account_id FROM fin_movement WHERE NOT is_demo)
         OR id IN (SELECT account_id FROM fin_invoice_payment WHERE NOT is_demo)
         OR id IN (SELECT pay_account_id FROM fin_card WHERE NOT is_demo)
         OR id IN (SELECT source_id FROM fin_recurring WHERE NOT is_demo AND source_type = 'CONTA'))
      RETURNING id`
    ).length +
    (
      await sql<{ id: string }[]>`
      UPDATE fin_card SET is_demo = FALSE
       WHERE is_demo AND (
         id IN (SELECT source_id FROM fin_entry_payment WHERE NOT is_demo AND source_type = 'CARTAO')
         OR id IN (SELECT card_id FROM fin_card_item WHERE NOT is_demo)
         OR id IN (SELECT card_id FROM fin_invoice_payment WHERE NOT is_demo)
         OR id IN (SELECT source_id FROM fin_recurring WHERE NOT is_demo AND source_type = 'CARTAO'))
      RETURNING id`
    ).length;

  const count = async (rows: PromiseLike<ArrayLike<unknown>>): Promise<number> =>
    (await rows).length;
  return {
    invoice_payments: await count(
      sql`DELETE FROM fin_invoice_payment WHERE is_demo RETURNING id`,
    ),
    card_items: await count(sql`DELETE FROM fin_card_item WHERE is_demo RETURNING id`),
    movements: await count(sql`DELETE FROM fin_movement WHERE is_demo RETURNING id`),
    entries: await count(sql`DELETE FROM fin_entry WHERE is_demo RETURNING id`),
    recurrings: await count(sql`DELETE FROM fin_recurring WHERE is_demo RETURNING id`),
    cards: await count(sql`DELETE FROM fin_card WHERE is_demo RETURNING id`),
    accounts: await count(sql`DELETE FROM fin_account WHERE is_demo RETURNING id`),
    categories: await count(sql`DELETE FROM fin_category WHERE is_demo RETURNING id`),
    kept,
  };
};
