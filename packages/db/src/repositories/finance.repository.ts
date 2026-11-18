import { ConflictError } from '@patrimonio/application';
import type { FinanceChanges, FinanceRepository } from '@patrimonio/application';
import { randomUUID } from 'node:crypto';

import { failure, success } from '@patrimonio/shared';
import type {
  FinAccount,
  FinCard,
  FinCardItem,
  FinCategory,
  FinEntry,
  FinInvoicePayment,
  FinMovement,
  FinRecurring,
  FinSnapshot,
} from '@patrimonio/domain';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

type Row = Record<string, unknown>;

const up = (value: string | null): string | null =>
  value === null ? null : value.toUpperCase();
const low = <T extends string>(value: string | null): T | null =>
  value === null ? null : (value.toLowerCase() as T);

/**
 * A foto inteira numa consulta. Dinheiro sai como texto (`::TEXT`): o JSON
 * numérico perderia a forma decimal exata.
 */
const SNAPSHOT_JSON = `jsonb_build_object(
    'categories', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.name), '[]') FROM fin_category t),
    'accounts', (SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object(
        'opening_amount', t.opening_amount::TEXT) ORDER BY t.name), '[]') FROM fin_account t),
    'cards', (SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object('limit_amount', t.limit_amount::TEXT) ORDER BY t.name), '[]') FROM fin_card t),
    'recurrings', (SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object(
        'amount', t.amount::TEXT, 'covers_up_to', t.covers_up_to::TEXT) ORDER BY t.day, t.name), '[]') FROM fin_recurring t),
    'skips', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]') FROM fin_recurring_skip t),
    'movements', (SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object('amount', t.amount::TEXT) ORDER BY t.date, t.id), '[]') FROM fin_movement t),
    'card_items', (SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object('amount', t.amount::TEXT) ORDER BY t.purchase_date, t.id), '[]') FROM fin_card_item t),
    'invoice_payments', (SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object('amount', t.amount::TEXT) ORDER BY t.date, t.id), '[]') FROM fin_invoice_payment t)
  )`;

/**
 * Os lançamentos saem em consultas simples, sem o JSON intermediário: com cinco
 * anos de histórico são vinte mil linhas, e agregá-las em `jsonb` para o Node
 * desfazer custava mais que a leitura. Datas e dinheiro saem como texto.
 */
const LOAD = `
  WITH snap AS (SELECT ${SNAPSHOT_JSON} AS snapshot)
  SELECT 0 AS ord, snap.snapshot,
         NULL::UUID AS id, NULL::TEXT AS kind, NULL::TEXT AS description, NULL::TEXT AS date,
         NULL::UUID AS category_id, NULL::TEXT AS amount, NULL::TEXT AS status,
         NULL::UUID AS recurring_id, NULL::UUID AS installment_group_id,
         NULL::INTEGER AS installment_no, NULL::INTEGER AS installment_total,
         NULL::TEXT AS installment_origin, NULL::TEXT AS note, NULL::UUID AS event_id,
         NULL::INTEGER AS version, NULL::TEXT AS p_source_type, NULL::UUID AS p_source_id,
         NULL::TEXT AS p_amount, NULL::TEXT AS p_invoice_month, NULL::INTEGER AS p_position
    FROM snap
  UNION ALL
  SELECT 1, NULL::JSONB, e.id, e.kind, e.description, e.date::TEXT, e.category_id,
         e.amount::TEXT, e.status, e.recurring_id, e.installment_group_id,
         e.installment_no, e.installment_total, e.installment_origin::TEXT,
         e.note, e.event_id, e.version,
         p.source_type, p.source_id, p.amount::TEXT, p.invoice_month, p.position
    FROM fin_entry e
    LEFT JOIN fin_entry_payment p ON p.entry_id = e.id
   ORDER BY ord, date DESC NULLS LAST, id DESC NULLS LAST, p_position
`;

const installment = (row: Row): FinEntry['installment'] =>
  row['installment_group_id'] === null || row['installment_group_id'] === undefined
    ? null
    : {
        group_id: row['installment_group_id'] as string,
        no: row['installment_no'] as number,
        total: row['installment_total'] as number,
        origin: row['installment_origin'] as string,
      };

const source = (type: unknown, id: unknown): FinRecurring['source'] => ({
  type: (type as string).toLowerCase() as 'conta' | 'cartao',
  id: id as string,
});

export const parseSnapshot = (raw: Record<string, Row[]>): FinSnapshot => ({
  categories: (raw['categories'] ?? []).map((r): FinCategory => ({
    id: r['id'] as string,
    name: r['name'] as string,
    kind: low(r['kind'] as string) as FinCategory['kind'],
    color: r['color'] as string,
    nature:
      r['nature'] === null || r['nature'] === undefined
        ? null
        : (low(r['nature'] as string) as 'fixa' | 'livre'),
    archived: r['archived'] as boolean,
    version: r['version'] as number,
  })),
  accounts: (raw['accounts'] ?? []).map((r): FinAccount => ({
    id: r['id'] as string,
    name: r['name'] as string,
    type: low(r['type'] as string) as FinAccount['type'],
    institution: (r['institution'] as string | null) ?? null,
    role: r['role'] as string,
    role_tag: (r['role_tag'] as string | null) ?? null,
    opening_amount: r['opening_amount'] as string,
    opening_date: r['opening_date'] as string,
    in_wealth: r['in_wealth'] as boolean,
    archived: r['archived'] as boolean,
    version: r['version'] as number,
  })),
  cards: (raw['cards'] ?? []).map((r): FinCard => ({
    id: r['id'] as string,
    name: r['name'] as string,
    last4: r['last4'] as string,
    pay_account_id: r['pay_account_id'] as string,
    limit_amount: r['limit_amount'] as string,
    closing_day: r['closing_day'] as number,
    due_day: r['due_day'] as number,
    archived: r['archived'] as boolean,
    version: r['version'] as number,
  })),
  recurrings: (raw['recurrings'] ?? []).map((r): FinRecurring => ({
    id: r['id'] as string,
    name: r['name'] as string,
    kind: low(r['kind'] as string) as FinRecurring['kind'],
    category_id: (r['category_id'] as string | null) ?? null,
    portfolio_id: (r['portfolio_id'] as string | null) ?? null,
    asset_id: (r['asset_id'] as string | null) ?? null,
    source: source(r['source_type'], r['source_id']),
    second_source:
      r['second_source_id'] === null
        ? null
        : source(r['second_source_type'], r['second_source_id']),
    covers_up_to: (r['covers_up_to'] as string | null) ?? null,
    note: (r['note'] as string | null) ?? null,
    day: r['day'] as number,
    mode: low(r['mode'] as string) as FinRecurring['mode'],
    amount: r['amount'] as string,
    active: r['active'] as boolean,
    version: r['version'] as number,
  })),
  skips: (raw['skips'] ?? []).map((r) => ({
    recurring_id: r['recurring_id'] as string,
    month: r['month'] as string,
  })),
  entries: (raw['entries'] ?? []).map((r): FinEntry => ({
    id: r['id'] as string,
    kind: low(r['kind'] as string) as FinEntry['kind'],
    description: r['description'] as string,
    date: r['date'] as string,
    category_id: r['category_id'] as string,
    amount: r['amount'] as string,
    status: low(r['status'] as string) as FinEntry['status'],
    recurring_id: (r['recurring_id'] as string | null) ?? null,
    installment: installment(r),
    note: (r['note'] as string | null) ?? null,
    event_id: (r['event_id'] as string | null) ?? null,
    payments: ((r['payments'] as Row[]) ?? []).map((p) => ({
      source_type: (p['source_type'] as string).toLowerCase() as 'conta' | 'cartao',
      source_id: p['source_id'] as string,
      amount: p['amount'] as string,
      invoice_month: (p['invoice_month'] as string | null) ?? null,
    })),
    version: r['version'] as number,
  })),
  movements: (raw['movements'] ?? []).map((r): FinMovement => ({
    id: r['id'] as string,
    date: r['date'] as string,
    account_id: r['account_id'] as string,
    kind: low(r['kind'] as string) as FinMovement['kind'],
    amount: r['amount'] as string,
    description: r['description'] as string,
    note: (r['note'] as string | null) ?? null,
    transfer_id: (r['transfer_id'] as string | null) ?? null,
    event_id: (r['event_id'] as string | null) ?? null,
  })),
  card_items: (raw['card_items'] ?? []).map((r): FinCardItem => ({
    id: r['id'] as string,
    card_id: r['card_id'] as string,
    kind: low(r['kind'] as string) as FinCardItem['kind'],
    subtype: low(r['subtype'] as string | null),
    purchase_date: r['purchase_date'] as string,
    invoice_month: r['invoice_month'] as string,
    description: r['description'] as string,
    category_id: (r['category_id'] as string | null) ?? null,
    amount: r['amount'] as string,
    installment: installment(r),
    reverses_id: (r['reverses_id'] as string | null) ?? null,
    version: r['version'] as number,
  })),
  invoice_payments: (raw['invoice_payments'] ?? []).map((r): FinInvoicePayment => ({
    id: r['id'] as string,
    card_id: r['card_id'] as string,
    invoice_month: r['invoice_month'] as string,
    account_id: r['account_id'] as string,
    date: r['date'] as string,
    amount: r['amount'] as string,
    posted: r['posted'] as boolean,
  })),
});

/** Quantas linhas a gravação precisava tocar e quantas tocou: a diferença é conflito de versão. */
class VersionConflict extends Error {}

const split = <T>(rows: readonly T[], size = 500): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
};

export const createFinanceRepository = (sql: Connection): FinanceRepository => ({
  load: async () => {
    try {
      const joined = await sql.unsafe<Row[]>(LOAD);
      const snapshot = (joined[0]?.['snapshot'] ?? {}) as Record<string, Row[]>;

      // Uma linha por parte de pagamento: junta de volta no lançamento, na ordem.
      const entries: Row[] = [];
      for (const line of joined.slice(1)) {
        const last = entries[entries.length - 1];
        const entry =
          last !== undefined && last['id'] === line['id']
            ? last
            : (entries[entries.push({ ...line, payments: [] }) - 1] as Row);
        if (line['p_source_type'] !== null) {
          (entry['payments'] as Row[]).push({
            source_type: line['p_source_type'],
            source_id: line['p_source_id'],
            amount: line['p_amount'],
            invoice_month: line['p_invoice_month'],
          });
        }
      }

      return success(parseSnapshot({ ...snapshot, entries }));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * Remove primeiro (filhos antes dos pais), depois grava na ordem das chaves
   * estrangeiras. `ON CONFLICT … WHERE version = EXCLUDED.version` faz o
   * UPDATE só valer se a versão lida ainda é a do banco; a linha nova nasce com
   * versão 1 e o UPDATE incrementa.
   */
  persist: async (changes: FinanceChanges) => {
    try {
      const del = async (
        table: string,
        ids: readonly string[],
        column = 'id',
      ): Promise<void> => {
        if (ids.length === 0) return;
        await sql`DELETE FROM ${sql(table)} WHERE ${sql(column)} IN ${sql(ids)}`;
      };

      await del('fin_invoice_payment', changes.invoice_payments.deletes);
      await del('fin_card_item', changes.card_items.deletes);
      await del('fin_movement', changes.movements.deletes);
      await del('fin_entry', changes.entries.deletes);
      for (const key of changes.skips.deletes) {
        const [recurringId, month] = key.split('|');
        await sql`DELETE FROM fin_recurring_skip WHERE recurring_id = ${recurringId as string} AND month = ${month as string}`;
      }
      await del('fin_recurring', changes.recurrings.deletes);
      await del('fin_card', changes.cards.deletes);
      await del('fin_account', changes.accounts.deletes);
      // A categoria sai por último: a exclusão com destino (CAT-04) regrava antes
      // os lançamentos e recorrentes que apontavam para ela.

      const guard = (expected: number, touched: number): void => {
        if (touched !== expected) throw new VersionConflict();
      };

      for (const chunk of split(changes.categories.upserts)) {
        const rows = chunk.map((r) => ({
          id: r.id,
          name: r.name,
          kind: up(r.kind),
          color: r.color,
          nature: up(r.nature ?? null),
          archived: r.archived,
          version: r.version,
        }));
        const out = await sql`
          INSERT INTO fin_category ${sql(rows)}
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, color = EXCLUDED.color,
            nature = EXCLUDED.nature, archived = EXCLUDED.archived, version = fin_category.version + 1
            WHERE fin_category.version = EXCLUDED.version
          RETURNING id`;
        guard(rows.length, out.length);
      }

      for (const chunk of split(changes.accounts.upserts)) {
        const rows = chunk.map((r) => ({
          id: r.id,
          name: r.name,
          type: up(r.type),
          institution: r.institution,
          role: r.role,
          role_tag: r.role_tag,
          opening_amount: r.opening_amount,
          opening_date: r.opening_date,
          in_wealth: r.in_wealth,
          archived: r.archived,
          version: r.version,
        }));
        const out = await sql`
          INSERT INTO fin_account ${sql(rows)}
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, institution = EXCLUDED.institution,
            role = EXCLUDED.role, role_tag = EXCLUDED.role_tag, opening_amount = EXCLUDED.opening_amount,
            opening_date = EXCLUDED.opening_date, in_wealth = EXCLUDED.in_wealth,
            archived = EXCLUDED.archived, version = fin_account.version + 1
            WHERE fin_account.version = EXCLUDED.version
          RETURNING id`;
        guard(rows.length, out.length);
      }

      for (const chunk of split(changes.cards.upserts)) {
        const rows = chunk.map((r) => ({
          id: r.id,
          name: r.name,
          last4: r.last4,
          pay_account_id: r.pay_account_id,
          limit_amount: r.limit_amount,
          closing_day: r.closing_day,
          due_day: r.due_day,
          archived: r.archived,
          version: r.version,
        }));
        const out = await sql`
          INSERT INTO fin_card ${sql(rows)}
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, last4 = EXCLUDED.last4, pay_account_id = EXCLUDED.pay_account_id,
            limit_amount = EXCLUDED.limit_amount, closing_day = EXCLUDED.closing_day, due_day = EXCLUDED.due_day,
            archived = EXCLUDED.archived, version = fin_card.version + 1
            WHERE fin_card.version = EXCLUDED.version
          RETURNING id`;
        guard(rows.length, out.length);
      }

      for (const chunk of split(changes.recurrings.upserts)) {
        const rows = chunk.map((r) => ({
          id: r.id,
          name: r.name,
          kind: up(r.kind),
          category_id: r.category_id,
          portfolio_id: r.portfolio_id ?? null,
          asset_id: r.asset_id ?? null,
          source_type: up(r.source.type),
          source_id: r.source.id,
          split: r.second_source !== null,
          second_source_type: up(r.second_source?.type ?? null),
          second_source_id: r.second_source?.id ?? null,
          covers_up_to: r.covers_up_to,
          note: r.note ?? null,
          day: r.day,
          mode: up(r.mode),
          amount: r.amount,
          active: r.active,
          version: r.version,
        }));
        const out = await sql`
          INSERT INTO fin_recurring ${sql(rows)}
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, category_id = EXCLUDED.category_id,
            portfolio_id = EXCLUDED.portfolio_id, asset_id = EXCLUDED.asset_id,
            source_type = EXCLUDED.source_type, source_id = EXCLUDED.source_id, split = EXCLUDED.split,
            second_source_type = EXCLUDED.second_source_type, second_source_id = EXCLUDED.second_source_id,
            covers_up_to = EXCLUDED.covers_up_to, note = EXCLUDED.note, day = EXCLUDED.day, mode = EXCLUDED.mode, amount = EXCLUDED.amount,
            active = EXCLUDED.active, version = fin_recurring.version + 1
            WHERE fin_recurring.version = EXCLUDED.version
          RETURNING id`;
        guard(rows.length, out.length);
      }

      if (changes.skips.upserts.length > 0) {
        await sql`INSERT INTO fin_recurring_skip ${sql(changes.skips.upserts.map((s) => ({ recurring_id: s.recurring_id, month: s.month })))} ON CONFLICT DO NOTHING`;
      }

      const touchedEntries = changes.entries.upserts.map((r) => r.id);
      for (const chunk of split(changes.entries.upserts)) {
        const rows = chunk.map((r) => ({
          id: r.id,
          kind: up(r.kind),
          description: r.description,
          date: r.date,
          category_id: r.category_id,
          amount: r.amount,
          status: up(r.status),
          recurring_id: r.recurring_id,
          installment_group_id: r.installment?.group_id ?? null,
          installment_no: r.installment?.no ?? null,
          installment_total: r.installment?.total ?? null,
          installment_origin: r.installment?.origin ?? null,
          note: r.note,
          event_id: r.event_id ?? null,
          version: r.version,
        }));
        const out = await sql`
          INSERT INTO fin_entry ${sql(rows)}
          ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, description = EXCLUDED.description, date = EXCLUDED.date,
            category_id = EXCLUDED.category_id, amount = EXCLUDED.amount, status = EXCLUDED.status,
            recurring_id = EXCLUDED.recurring_id, installment_group_id = EXCLUDED.installment_group_id,
            installment_no = EXCLUDED.installment_no, installment_total = EXCLUDED.installment_total,
            installment_origin = EXCLUDED.installment_origin, note = EXCLUDED.note, event_id = EXCLUDED.event_id, version = fin_entry.version + 1
            WHERE fin_entry.version = EXCLUDED.version
          RETURNING id`;
        guard(rows.length, out.length);
      }

      if (touchedEntries.length > 0) {
        // Os pagamentos são reescritos por inteiro; a checagem de soma é adiada ao commit.
        await sql`DELETE FROM fin_entry_payment WHERE entry_id IN ${sql(touchedEntries)}`;
        const parts = changes.entries.upserts.flatMap((entry) =>
          entry.payments.map((payment, index) => ({
            id: randomUUID(),
            entry_id: entry.id,
            source_type: up(payment.source_type),
            source_id: payment.source_id,
            amount: payment.amount,
            position: index + 1,
            invoice_month: payment.invoice_month,
          })),
        );
        for (const chunk of split(parts)) {
          await sql`INSERT INTO fin_entry_payment ${sql(chunk)}`;
        }
      }

      for (const chunk of split(changes.movements.upserts)) {
        const rows = chunk.map((r) => ({
          id: r.id,
          date: r.date,
          account_id: r.account_id,
          kind: up(r.kind),
          amount: r.amount,
          description: r.description,
          note: r.note,
          transfer_id: r.transfer_id,
          event_id: r.event_id ?? null,
        }));
        await sql`
          INSERT INTO fin_movement ${sql(rows)}
          ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, account_id = EXCLUDED.account_id, kind = EXCLUDED.kind,
            amount = EXCLUDED.amount, description = EXCLUDED.description, note = EXCLUDED.note,
            transfer_id = EXCLUDED.transfer_id, event_id = EXCLUDED.event_id`;
      }

      for (const chunk of split(changes.card_items.upserts)) {
        const rows = chunk.map((r) => ({
          id: r.id,
          card_id: r.card_id,
          kind: up(r.kind),
          subtype: up(r.subtype),
          purchase_date: r.purchase_date,
          invoice_month: r.invoice_month,
          description: r.description,
          category_id: r.category_id,
          amount: r.amount,
          installment_group_id: r.installment?.group_id ?? null,
          installment_no: r.installment?.no ?? null,
          installment_total: r.installment?.total ?? null,
          installment_origin: r.installment?.origin ?? null,
          reverses_id: r.reverses_id ?? null,
          version: r.version,
        }));
        const out = await sql`
          INSERT INTO fin_card_item ${sql(rows)}
          ON CONFLICT (id) DO UPDATE SET card_id = EXCLUDED.card_id, kind = EXCLUDED.kind, subtype = EXCLUDED.subtype,
            purchase_date = EXCLUDED.purchase_date, invoice_month = EXCLUDED.invoice_month,
            description = EXCLUDED.description, category_id = EXCLUDED.category_id, amount = EXCLUDED.amount,
            installment_group_id = EXCLUDED.installment_group_id, installment_no = EXCLUDED.installment_no,
            installment_total = EXCLUDED.installment_total, installment_origin = EXCLUDED.installment_origin, reverses_id = EXCLUDED.reverses_id,
            version = fin_card_item.version + 1
            WHERE fin_card_item.version = EXCLUDED.version
          RETURNING id`;
        guard(rows.length, out.length);
      }

      for (const chunk of split(changes.invoice_payments.upserts)) {
        const rows = chunk.map((r) => ({
          id: r.id,
          card_id: r.card_id,
          invoice_month: r.invoice_month,
          account_id: r.account_id,
          date: r.date,
          amount: r.amount,
          posted: r.posted,
        }));
        await sql`
          INSERT INTO fin_invoice_payment ${sql(rows)}
          ON CONFLICT (id) DO UPDATE SET account_id = EXCLUDED.account_id, date = EXCLUDED.date,
            amount = EXCLUDED.amount, posted = EXCLUDED.posted`;
      }

      await del('fin_category', changes.categories.deletes);

      return success(undefined);
    } catch (error) {
      if (error instanceof VersionConflict) {
        return failure(
          new ConflictError(
            'Os dados foram alterados em outro lugar. Recarregue e tente de novo.',
          ),
        );
      }
      return failure(getRepositoryError(error));
    }
  },

  findIdempotent: async (key: string) => {
    try {
      const rows = await sql<{ operation: string; status: number; response: unknown }[]>`
        SELECT operation, status, response FROM fin_idempotency
         WHERE key = ${key} AND created_at > NOW() - INTERVAL '24 hours'`;
      const row = rows[0];
      return success(
        row === undefined
          ? null
          : { operation: row.operation, status: row.status, body: row.response },
      );
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  saveIdempotent: async (key, record) => {
    try {
      await sql`
        INSERT INTO fin_idempotency (key, operation, response, status)
        VALUES (${key}, ${record.operation}, ${sql.json(record.body as never)}, ${record.status})
        ON CONFLICT (key) DO UPDATE SET operation = EXCLUDED.operation, response = EXCLUDED.response,
          status = EXCLUDED.status, created_at = NOW()`;
      return success(undefined);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
