import { finance as fin } from '@patrimonio/calc';
import type { FinSnapshot, Transaction } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../../errors/app-error.js';
import { FinanceError } from '../../errors/finance-error.js';
import type { TransactionalRepositories } from '../../interfaces/unit-of-work.js';

const LEG_KIND = { buy: 'aporte', sell: 'resgate', payout: 'provento' } as const;

const rule = (code: string, message: string, field: string, status = 422) =>
  failure(new FinanceError([{ code, message, field }], status));

export type LegsSync = {
  /** O `event_id` da transação depois da edição: nasce quando a conta passa a existir. */
  readonly event_id: string | null;
};

/**
 * LIV-12 · Depois de editar a linha de posição, a perna financeira acompanha:
 * valor, data e conta de origem/destino. Tudo na transação de quem chama.
 *
 *  - aporte sai da conta (−líquido), resgate e provento entram (+líquido);
 *  - a despesa ligada ao resgate muda de valor e data junto;
 *  - trocar a conta para "Fora do app" apaga a perna; escolher uma conta
 *    onde não havia nenhuma cria a perna.
 */
export const syncLegs = async (
  repositories: TransactionalRepositories,
  input: {
    readonly before: Transaction;
    readonly after: Transaction;
    /** `undefined` mantém a conta; `null` é "Fora do app". */
    readonly account_id: string | null | undefined;
    readonly ticker: string;
    readonly today: string;
  },
): Promise<Either<AppError, LegsSync>> => {
  const { before: oldTx, after: newTx } = input;
  const kind = LEG_KIND[oldTx.kind as keyof typeof LEG_KIND];
  if (kind === undefined) return success({ event_id: oldTx.event_id ?? null });

  const eventId = oldTx.event_id ?? null;
  const loaded = await repositories.finance.load();
  if (loaded.isFailure()) return loaded;
  const snapshot: FinSnapshot = loaded.value;

  const existing =
    eventId === null ? undefined : snapshot.movements.find((m) => m.event_id === eventId);
  const accountId =
    input.account_id === undefined ? existing?.account_id : input.account_id;

  if (accountId !== null && accountId !== undefined) {
    if (snapshot.cards.some((card) => card.id === accountId)) {
      return rule(
        'LANCAMENTO_ORIGEM_CARTAO',
        'A origem ou o destino não pode ser um cartão. Escolha uma conta.',
        'account_id',
      );
    }
    const account = snapshot.accounts.find((a) => a.id === accountId);
    if (account === undefined) {
      return rule('CONTA_NAO_ENCONTRADA', 'A conta não existe.', 'account_id', 404);
    }
    if (account.archived) {
      return rule('CONTA_ARQUIVADA', 'A conta está arquivada.', 'account_id', 409);
    }
  }

  const amount = fin.money(fin.dec(newTx.net_amount).abs());
  const signed = kind === 'aporte' ? `-${amount}` : amount;
  const date = kind === 'provento' ? newTx.settlement_date : newTx.trade_date;
  const newEventId = eventId ?? repositories.transactions.nextId();

  const movements = snapshot.movements.filter(
    (m) => m.event_id !== eventId || eventId === null,
  );
  const keep = accountId === null || accountId === undefined;
  if (!keep) {
    movements.push({
      id: existing?.id ?? repositories.transactions.nextId(),
      date,
      account_id: accountId,
      kind,
      amount: signed,
      description:
        existing?.description ??
        `${kind[0]?.toUpperCase()}${kind.slice(1)} de ${input.ticker}`,
      note: existing?.note ?? null,
      transfer_id: null,
      event_id: newEventId,
    });
  }

  const entries = snapshot.entries.map((entry) =>
    eventId !== null && entry.event_id === eventId
      ? {
          ...entry,
          date: newTx.trade_date,
          amount,
          payments: entry.payments.map((p) => ({ ...p, amount })),
        }
      : entry,
  );

  const after: FinSnapshot = { ...snapshot, movements, entries };
  const changes = fin.diffSnapshots(snapshot, after);
  if (!fin.isEmptyChange(changes)) {
    const saved = await repositories.finance.persist(changes);
    if (saved.isFailure()) return saved;
  }

  return success({ event_id: keep ? null : newEventId });
};
