import type { EntryBody, TransferBody } from '@patrimonio/contracts';

import type { EffectResource } from '../api/ledger_write.js';
import type { EffectRow } from '../finance/domain/effects.js';
import { parseDecimal } from './decimal.js';

/**
 * LAN-09 · O rascunho do modal "Novo lançamento" e o que dele vira pedido.
 *
 * Os tipos entram à medida que o servidor os grava; hoje, receita e despesa.
 * Trocar de tipo mantém os campos compatíveis (data, valor, conta, descrição) e
 * descarta só a categoria, que é de um tipo.
 */
export const MODAL_KINDS = ['RECEITA', 'DESPESA', 'TRANSFERENCIA'] as const;
export type ModalKind = (typeof MODAL_KINDS)[number];

export const MODAL_KIND_LABEL: Readonly<Record<ModalKind, string>> = {
  RECEITA: 'Receita',
  DESPESA: 'Despesa',
  TRANSFERENCIA: 'Transferência',
};

export type Draft = {
  readonly kind: ModalKind;
  readonly description: string;
  readonly date: string;
  readonly amount: string;
  readonly accountId: string;
  /** Só transferência: a conta de destino. */
  readonly toAccountId: string;
  readonly categoryId: string;
};

export type DraftContext = {
  readonly accountId?: string | undefined;
  readonly cardId?: string | undefined;
  readonly portfolioId?: string | undefined;
  readonly assetId?: string | undefined;
  readonly invoice?: boolean | undefined;
};

/** O tipo inicial vem do contexto: fatura → pagamento; ativo → aporte; resto → despesa. */
export const initialKind = (_context: DraftContext): ModalKind => 'DESPESA';

export const newDraft = (
  today: string,
  context: DraftContext = {},
  kind: ModalKind = initialKind(context),
): Draft => ({
  kind,
  description: '',
  date: today,
  amount: '',
  accountId: context.accountId ?? '',
  toAccountId: '',
  categoryId: '',
});

export const switchKind = (draft: Draft, kind: ModalKind): Draft =>
  kind === draft.kind ? draft : { ...draft, kind, categoryId: '', toAccountId: '' };

export type DraftErrors = Partial<Record<keyof Draft, string>>;

/** RN-03: lançamento não nasce no futuro; para o futuro, um recorrente. */
export const FUTURE_DATE_MESSAGE =
  'Data futura não é lançamento. Crie um recorrente ou um previsto.';

export const validateDraft = (draft: Draft, today: string): DraftErrors => {
  const errors: DraftErrors = {};
  const transfer = draft.kind === 'TRANSFERENCIA';
  if (!transfer && draft.description.trim() === '') {
    errors.description = 'Informe a descrição.';
  }
  if (draft.date === '') errors.date = 'Informe a data.';
  else if (draft.date > today) errors.date = FUTURE_DATE_MESSAGE;
  const amount = parseDecimal(draft.amount.replace(',', '.'));
  if (
    amount === null ||
    amount.negative ||
    /^0*$/.test(amount.integer + amount.fraction)
  ) {
    errors.amount = 'Informe um valor maior que zero.';
  }
  if (draft.accountId === '') {
    errors.accountId = transfer ? 'Escolha a conta de origem.' : 'Escolha a conta.';
  }
  if (transfer) {
    if (draft.toAccountId === '') errors.toAccountId = 'Escolha a conta de destino.';
    else if (draft.toAccountId === draft.accountId) {
      errors.toAccountId = 'Origem e destino precisam ser contas diferentes.';
    }
  } else if (draft.categoryId === '') errors.categoryId = 'Escolha a categoria.';
  return errors;
};

export const isValid = (errors: DraftErrors): boolean => Object.keys(errors).length === 0;

const decimal = (value: string): string => value.trim().replace(',', '.');

export type EntryRequest =
  | { readonly path: '/api/finance/entries'; readonly body: EntryBody }
  | { readonly path: '/api/finance/transfers'; readonly body: TransferBody };

/** Vírgula decimal digitada vira o ponto que o contrato pede. */
export const toRequest = (draft: Draft): EntryRequest =>
  draft.kind === 'TRANSFERENCIA'
    ? {
        path: '/api/finance/transfers',
        body: {
          from_account_id: draft.accountId,
          to_account_id: draft.toAccountId,
          amount: decimal(draft.amount),
          date: draft.date,
          note: draft.description.trim() === '' ? null : draft.description.trim(),
        },
      }
    : {
        path: '/api/finance/entries',
        body: {
          kind: draft.kind === 'RECEITA' ? 'receita' : 'despesa',
          description: draft.description.trim(),
          date: draft.date,
          category_id: draft.categoryId,
          amount: decimal(draft.amount),
          payments: [{ source_type: 'conta', source_id: draft.accountId }],
          status: 'lancada',
        },
      };

const cents = (value: string): number => {
  const parts = parseDecimal(value);
  if (parts === null) return 0;
  const frac = `${parts.fraction}00`.slice(0, 2);
  const total = Number(parts.integer) * 100 + Number(frac);
  return parts.negative ? -total : total;
};

/** As linhas do bloco "Efeito" a partir do preview do servidor. */
export const effectRows = (effect: EffectResource): readonly EffectRow[] => [
  ...effect.accounts.map((a) => ({
    label: `Saldo · ${a.name}`,
    before: cents(a.before),
    after: cents(a.after),
  })),
  ...effect.months.flatMap((m) => [
    {
      label: `Receitas · ${m.month}`,
      before: cents(m.receitas_before),
      after: cents(m.receitas_after),
    },
    {
      label: `Despesas · ${m.month}`,
      before: cents(m.despesas_before),
      after: cents(m.despesas_after),
    },
  ]),
];
