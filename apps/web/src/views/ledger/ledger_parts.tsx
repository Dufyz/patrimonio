import type { BookRowResource } from '@patrimonio/contracts';

import { KindTag } from '../../finance/components/tags.js';
import { cn } from '../../lib/cn.js';

/**
 * As peças visuais da tela Lançamentos (pranchas 2.1 a 2.3): a etiqueta do tipo,
 * o filtro em menu e a coluna "Conta / Carteira". Nenhuma delas calcula valor.
 */

export const KIND_LABEL: Readonly<Record<BookRowResource['kind'], string>> = {
  RECEITA: 'Receita',
  DESPESA: 'Despesa',
  TRANSFERENCIA: 'Transferência',
  PAGAMENTO_FATURA: 'Pag. de fatura',
  APORTE: 'Aporte',
  RESGATE: 'Resgate',
  PROVENTO: 'Provento',
  EVENTO: 'Evento',
};

/** O nome inteiro do tipo, para filtros e chips (a etiqueta da linha é abreviada). */
export const KIND_FULL_LABEL: Readonly<Record<BookRowResource['kind'], string>> = {
  ...KIND_LABEL,
  PAGAMENTO_FATURA: 'Pagamento de fatura',
};

const SOLID: Readonly<Record<BookRowResource['kind'], string>> = {
  RECEITA: 'bg-positive-soft text-positive',
  DESPESA: 'bg-negative-soft text-negative',
  TRANSFERENCIA: 'bg-type-cash text-type-cash-ink',
  PAGAMENTO_FATURA: 'bg-type-move text-type-move-ink',
  APORTE: 'bg-type-buy text-type-buy-ink',
  RESGATE: 'bg-type-sell text-type-sell-ink',
  PROVENTO: 'bg-type-income text-type-income-ink',
  EVENTO: 'border border-line-2 text-ink-2',
};

/** Lançado: pastilha cheia. Previsto: só o contorno tracejado (a mesma regra das outras telas). */
export const LedgerKindTag = ({
  kind,
  planned,
}: {
  readonly kind: BookRowResource['kind'];
  readonly planned: boolean;
}): React.ReactElement =>
  planned ? (
    <KindTag kind={kind}>{KIND_LABEL[kind]}</KindTag>
  ) : (
    <span
      data-kind={kind}
      className={cn(
        'inline-flex items-center rounded-[4px] px-2 py-0.5 text-[0.71875rem] font-medium',
        SOLID[kind],
      )}
    >
      {KIND_LABEL[kind]}
    </span>
  );

/** A seta entre origem e destino. */
export const Arrow = (): React.ReactElement => (
  <span aria-hidden="true" className="mx-1.5 text-ink-3">
    →
  </span>
);

type PaymentLike = {
  readonly source_id: string;
  readonly amount?: string;
};

export type PartyNames = {
  readonly account: (id: string) => string | null;
  readonly card: (id: string) => string | null;
  readonly portfolio: (id: string) => string | null;
  readonly source: (id: string) => string | null;
  /** Valor sem moeda, com o sinal de saída, já respeitando "ocultar valores". */
  readonly out: (value: string) => string;
};

/** O código do ativo, sempre a última palavra da descrição ("Provento DIVO11"). */
const tickerOf = (row: BookRowResource): string =>
  row.description.split(' ').at(-1) ?? row.description;

/**
 * A coluna "Conta / Carteira": de onde sai e para onde vai, na ordem do dinheiro.
 * Despesa paga em duas origens lista as duas, cada uma com a sua parte.
 */
export const PartiesCell = ({
  row,
  names,
}: {
  readonly row: BookRowResource;
  readonly names: PartyNames;
}): React.ReactElement => {
  const account = (id: string | null): string =>
    id === null ? '—' : (names.account(id) ?? names.card(id) ?? '—');
  const portfolio =
    row.portfolio_id === null ? '—' : (names.portfolio(row.portfolio_id) ?? '—');

  switch (row.kind) {
    case 'DESPESA': {
      const payments =
        (row.entry as { payments?: readonly PaymentLike[] } | null)?.payments ?? [];
      if (payments.length > 1) {
        return (
          <span>
            {payments.map((payment, index) => (
              <span key={payment.source_id}>
                {index === 0 ? null : <span className="mx-1.5 text-ink-3">+</span>}
                {names.source(payment.source_id) ?? '—'}
                {payment.amount === undefined ? null : (
                  <span className="tabular ml-1.5 text-xs text-ink-3">
                    {names.out(payment.amount)}
                  </span>
                )}
              </span>
            ))}
          </span>
        );
      }
      return <span>{account(row.account_id ?? row.card_id)}</span>;
    }
    case 'TRANSFERENCIA':
      return (
        <span>
          {account(row.account_id)}
          <Arrow />
          {account(row.to_account_id)}
        </span>
      );
    case 'PAGAMENTO_FATURA':
      return (
        <span>
          {account(row.account_id)}
          <Arrow />
          {account(row.card_id)}
        </span>
      );
    case 'APORTE':
      return (
        <span>
          {account(row.account_id)}
          <Arrow />
          {portfolio}
        </span>
      );
    case 'RESGATE':
      return (
        <span>
          {portfolio}
          <Arrow />
          {account(row.account_id)}
        </span>
      );
    case 'PROVENTO':
      return (
        <span>
          {tickerOf(row)}
          <Arrow />
          {account(row.account_id)}
        </span>
      );
    case 'EVENTO':
      return <span>{portfolio}</span>;
    case 'RECEITA':
      return <span>{account(row.account_id)}</span>;
  }
};
