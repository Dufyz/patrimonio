/**
 * LIV-01 · Os tipos do livro único. Todo dinheiro que se move é um lançamento de
 * um destes oito tipos; o vocabulário do módulo de investimentos mapeia assim:
 * Compra = Aporte, Venda = Resgate, Custódia = Evento, Dividendo/JCP = Provento.
 */
export const LEDGER_KINDS = [
  'RECEITA',
  'DESPESA',
  'TRANSFERENCIA',
  'PAGAMENTO_FATURA',
  'APORTE',
  'RESGATE',
  'PROVENTO',
  'EVENTO',
] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const isLedgerKind = (value: unknown): value is LedgerKind =>
  typeof value === 'string' && (LEDGER_KINDS as readonly string[]).includes(value);

/** Vocabulário de `transaction` (investimentos) → tipo do livro. */
export const LEDGER_KIND_OF_TRANSACTION = {
  compra: 'APORTE',
  venda: 'RESGATE',
  custodia: 'EVENTO',
  dividendo: 'PROVENTO',
  jcp: 'PROVENTO',
} as const satisfies Readonly<Record<string, LedgerKind>>;

/**
 * Efeito de um lançamento nos números do mês (§2.2 da especificação). É o oráculo
 * dos testes da cascata: nenhuma tela decide isso por conta própria.
 *
 * - `receitas`/`despesas`: entra nas somas de Receitas ou de Despesas.
 * - `aportes`: entra em Aportes, a terceira linha da cascata.
 * - `saldo_do_mes`: sinal do efeito no Saldo do mês (−1 reduz, 0 não altera).
 * - `patrimonio`: o que o lançamento faz ao Patrimônio total.
 */
export type LedgerEffect = {
  readonly receitas: boolean;
  readonly despesas: boolean;
  readonly aportes: boolean;
  readonly saldo_do_mes: 1 | 0 | -1;
  readonly patrimonio: 'sobe' | 'cai' | 'igual';
};

export const LEDGER_EFFECTS: Readonly<Record<LedgerKind, LedgerEffect>> = {
  RECEITA: {
    receitas: true,
    despesas: false,
    aportes: false,
    saldo_do_mes: 1,
    patrimonio: 'sobe',
  },
  DESPESA: {
    receitas: false,
    despesas: true,
    aportes: false,
    saldo_do_mes: -1,
    patrimonio: 'cai',
  },
  // A conta de origem cai e a de destino sobe: nada muda no total.
  TRANSFERENCIA: {
    receitas: false,
    despesas: false,
    aportes: false,
    saldo_do_mes: 0,
    patrimonio: 'igual',
  },
  // Quitar a fatura só tira da conta o que a compra já tinha contado (RN-U4).
  PAGAMENTO_FATURA: {
    receitas: false,
    despesas: false,
    aportes: false,
    saldo_do_mes: 0,
    patrimonio: 'igual',
  },
  // A conta cai e a carteira sobe; o aporte reduz o Saldo do mês (RN-U1).
  APORTE: {
    receitas: false,
    despesas: false,
    aportes: true,
    saldo_do_mes: -1,
    patrimonio: 'igual',
  },
  // Troca posição por caixa: não é receita e não mexe no Saldo do mês.
  RESGATE: {
    receitas: false,
    despesas: false,
    aportes: false,
    saldo_do_mes: 0,
    patrimonio: 'igual',
  },
  // Credita a conta e entra no retorno, mas não é receita (RN-U5).
  PROVENTO: {
    receitas: false,
    despesas: false,
    aportes: false,
    saldo_do_mes: 0,
    patrimonio: 'sobe',
  },
  // Ajusta quantidade ou custódia, sem valor e sem dinheiro.
  EVENTO: {
    receitas: false,
    despesas: false,
    aportes: false,
    saldo_do_mes: 0,
    patrimonio: 'igual',
  },
};
