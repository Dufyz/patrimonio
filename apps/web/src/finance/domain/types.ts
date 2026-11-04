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
  /** Parcela n de N de uma compra no cartão (RN-45). */
  readonly installment?: { readonly n: number; readonly of: number };
  readonly payments: readonly Payment[];
  /**
   * Anterior ao período acompanhado: conta nas médias por categoria, mas não
   * move saldo nem fatura.
   */
  readonly historical?: boolean;
};

export type RecurringMode = 'automatico' | 'manual';

/**
 * RN-10 a RN-16: o modelo que gera um previsto por mês. O valor é fixo no modo
 * automático e só uma estimativa no manual (RN-12).
 *
 * A origem de pagamento é uma, ou duas: com `secondSourceId`, a primeira cobre
 * até `coversUpTo` e a segunda o resto (RN-20, RN-21).
 */
export type Recurring = {
  readonly id: string;
  readonly name: string;
  readonly kind: EntryKind;
  readonly categoryId: string;
  readonly sourceId: string;
  readonly secondSourceId?: string;
  readonly coversUpTo?: Cents;
  /** Dia do mês, de 1 a 31; em mês curto cai no último dia (RN-10). */
  readonly day: number;
  readonly mode: RecurringMode;
  readonly cents: Cents;
  readonly active: boolean;
};

export type AccountType = 'conta' | 'beneficio';

/**
 * RN-30 a RN-38: onde o dinheiro está. Conta entra no saldo em contas; benefício
 * fica fora (RN-30). O saldo é o inicial mais as movimentações (RN-31).
 */
export type Account = {
  readonly id: string;
  readonly name: string;
  /** Descrição do papel, em frase: "Recebe as receitas e paga as despesas". */
  readonly role: string;
  /** O papel curto da etiqueta do Extrato: "recebe receitas e paga despesas". */
  readonly roleTag?: string;
  readonly institution?: string;
  readonly type: AccountType;
  /** Saldo antes da primeira movimentação acompanhada. */
  readonly initialCents: Cents;
  /** Benefício: crédito fixo mensal e o dia dele (RN-36). */
  readonly creditCents?: Cents;
  readonly creditDay?: number;
  /** Primeiro mês (`AAAA-MM-01`) em que o crédito é gerado sozinho. */
  readonly creditsFrom?: IsoDate;
  readonly archived?: boolean;
};

/** O que move uma conta além dos lançamentos (RN-32 a RN-34, RN-36). */
export type MovementKind = 'transferencia' | 'fatura' | 'credito' | 'ajuste';

/**
 * Movimentação fora de Lançamentos: nunca é receita nem despesa (RN-33).
 * `cents` leva o sinal: positivo entra na conta, negativo sai. A transferência
 * são duas pernas com o mesmo `transferId` (RN-34).
 */
export type Movement = {
  readonly id: string;
  readonly date: IsoDate;
  readonly accountId: string;
  readonly kind: MovementKind;
  readonly cents: Cents;
  readonly description: string;
  readonly note?: string;
  readonly transferId?: string;
};

export type FinanceData = {
  readonly accounts: readonly Account[];
  readonly movements: readonly Movement[];
  readonly categories: readonly Category[];
  readonly recurrings: readonly Recurring[];
  readonly entries: readonly Entry[];
  /**
   * Meses de um recorrente em que o lançamento foi excluído (`r-netflix:2026-10`):
   * o previsto não é regenerado (RN-06).
   */
  readonly skips?: readonly string[];
};
