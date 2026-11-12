import type { Decimal } from 'decimal.js';

import { dec, max, money, ZERO } from './money.js';

/**
 * LIV-08 e LIV-09 · A cascata do mês, o Patrimônio total e o Livre após faturas.
 * Funções puras sobre valores já somados: quem soma (contas, carteiras, faturas)
 * é o motor de cada lado, e nenhuma tela refaz estas contas (RN-U16).
 */

export type CascadeInput = {
  readonly receitas: string;
  readonly despesas: string;
  readonly aportes: string;
};

export type Cascade = {
  readonly receitas: string;
  readonly despesas: string;
  readonly aportes: string;
  /** Receitas − Despesas − Aportes, com sinal (RN-U1). */
  readonly saldo_do_mes: string;
};

/**
 * Despesas já vem sem aporte, resgate, provento, transferência e pagamento de
 * fatura: esses tipos não entram na soma de Despesas (ver `LEDGER_EFFECTS`).
 */
export const monthCascade = (input: CascadeInput): Cascade => ({
  receitas: money(dec(input.receitas)),
  despesas: money(dec(input.despesas)),
  aportes: money(dec(input.aportes)),
  saldo_do_mes: money(dec(input.receitas).minus(input.despesas).minus(input.aportes)),
});

export type WealthInput = {
  /** Soma das carteiras na última consolidação; `null` quando nenhuma foi consolidada. */
  readonly em_carteiras: string | null;
  /** Soma das contas ativas com a marca "no patrimônio". */
  readonly em_contas: string;
};

export type Wealth = {
  readonly em_carteiras: string | null;
  readonly em_contas: string;
  /** `null` quando as carteiras não foram consolidadas: traço na tela, nunca zero. */
  readonly patrimonio: string | null;
};

/** RN-U2 · Patrimônio = Em carteiras + Em contas. Fatura não entra nem desconta. */
export const wealth = (input: WealthInput): Wealth => ({
  em_carteiras: input.em_carteiras === null ? null : money(dec(input.em_carteiras)),
  em_contas: money(dec(input.em_contas)),
  patrimonio:
    input.em_carteiras === null
      ? null
      : money(dec(input.em_carteiras).plus(input.em_contas)),
});

export type FreeAfterInvoices = {
  /** Máx(0; Em contas − total devido). */
  readonly livre: string;
  /** Quanto falta para as contas cobrirem as faturas; zero quando cobrem. */
  readonly falta: string;
  readonly total_devido: string;
};

/** RN-U3 · Faturas só subtraem de saldo em conta, no máximo até zerar. */
export const freeAfterInvoices = (
  emContas: string,
  openInvoices: string,
  closedToPay: string,
): FreeAfterInvoices => {
  const owed: Decimal = dec(openInvoices).plus(closedToPay);
  const balance = dec(emContas);
  return {
    livre: money(max(ZERO, balance.minus(owed))),
    falta: money(max(ZERO, owed.minus(balance))),
    total_devido: money(owed),
  };
};
