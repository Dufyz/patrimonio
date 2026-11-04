import type { IsoDate } from '../lib/dates.js';
import type { Cents } from '../lib/money.js';

/**
 * O modelo de domínio de Finanças.
 *
 * Tudo em centavos inteiros (RN-65) e datas em texto ISO. Só o que as histórias
 * já entregues precisam existe aqui; cada fase acrescenta o seu pedaço (contas,
 * cartões, recorrentes) sem reescrever o que veio antes.
 */

export type EntryKind = 'receita' | 'despesa';

/** RN-60: nome, tipo e cor; o nome é único dentro do tipo. */
export type Category = {
  readonly id: string;
  readonly name: string;
  readonly kind: EntryKind;
  /** Identificador da paleta (`violet`), nunca um hexadecimal. */
  readonly color: string;
};

/** RN-02: previsto ou lançado. Só o lançado conta em saldos, totais e categorias. */
export type EntryStatus = 'prevista' | 'lancada';

/** Uma origem de pagamento e a parte do valor que ela cobre (RN-01, RN-20). */
export type Payment = { readonly sourceId: string; readonly cents: Cents };

export type Entry = {
  readonly id: string;
  readonly kind: EntryKind;
  readonly date: IsoDate;
  readonly description: string;
  readonly categoryId: string;
  /** Sempre maior que zero; o sinal vem do tipo. */
  readonly cents: Cents;
  readonly status: EntryStatus;
  readonly recurringId?: string;
  readonly payments: readonly Payment[];
  /**
   * Anterior ao período acompanhado: conta nas médias por categoria, mas não
   * move saldo nem fatura.
   */
  readonly historical?: boolean;
};

export type FinanceData = {
  readonly categories: readonly Category[];
  readonly entries: readonly Entry[];
};
