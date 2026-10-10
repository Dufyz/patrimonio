import { PAYOUT_KINDS, TRANSACTION_KINDS } from '@patrimonio/domain';
import { z } from 'zod';

import { b3TypeSchema } from '../asset/asset.schema.js';
import {
  dateOnly,
  decimalString,
  pagination,
  uuid,
} from '../support/primitives.schema.js';

/**
 * T-04 · O extrato do livro de lançamentos.
 *
 * Movimentações é onde o usuário corrige o passado, e o formato segue disso: a
 * pergunta não é "quanto tenho", é "o que aconteceu, e o que cada lançamento
 * mudou". Por isso a resposta carrega, junto de cada linha, o **efeito** dela na
 * posição — preço médio de antes e de depois, resultado realizado, isenção —,
 * calculado pelo mesmo motor que o recálculo usa. Um extrato cujo "preço médio
 * depois" difere do de Posições por um centavo é um extrato que não confere.
 *
 * Três regras valem aqui, como em todo contrato desta aplicação:
 *
 * - **Todo agregado vem pronto.** Resumo do período, subtotal do mês e contagem
 *   por tipo são somados pela `api`, com o filtro aplicado. A tela não soma, e
 *   por isso o subtotal do mês continua certo quando o mês atravessa duas
 *   páginas.
 * - **Valor monetário viaja como string**, e ausência é `null`, nunca zero.
 * - **O filtro de tipo não muda a própria contagem.** As pastilhas mostram
 *   quantos lançamentos cada tipo teria sob os *outros* filtros; contar sob o
 *   tipo já escolhido zeraria todas as outras no primeiro clique.
 */

/**
 * Os tipos como as pastilhas os agrupam: aporte e resgate são uma pastilha só
 * ("Aportes e resgates"), porque é assim que alguém pergunta pelo dinheiro que
 * entrou e saiu.
 */
export const STATEMENT_GROUPS = [
  'buy',
  'sell',
  'payout',
  'cash',
  'event',
] as const;

export const statementGroupSchema = z.enum(STATEMENT_GROUPS);

export type StatementGroup = z.infer<typeof statementGroupSchema>;

/** Quais tipos de lançamento cada grupo reúne. */
export const STATEMENT_GROUP_KINDS: Readonly<
  Record<StatementGroup, readonly (typeof TRANSACTION_KINDS)[number][]>
> = {
  buy: ['buy'],
  sell: ['sell'],
  payout: ['payout'],
  cash: ['deposit', 'withdrawal'],
  event: ['corporate_event'],
};

export const getStatementSchema = z.object({
  query: pagination
    .extend({
      portfolio_id: uuid,
      institution_id: uuid.optional(),
      /** Ausente é "Todos". */
      group: statementGroupSchema.optional(),
      /** Casa com código e nome do ativo, sem distinguir maiúscula. */
      search: z.string().trim().max(120).optional(),
      from: dateOnly.optional(),
      to: dateOnly.optional(),
    })
    .refine(
      (query) =>
        query.from === undefined || query.to === undefined || query.from <= query.to,
      {
        message: 'o início do período não pode ser depois do fim',
        path: ['from'],
      },
    ),
});

export type GetStatementQuery = z.infer<typeof getStatementSchema>['query'];

/**
 * O que o lançamento mudou, em forma que a tela traduz em uma frase curta. Cada
 * variante carrega só o número que a frase usa.
 *
 * `average_price` e `position_opened` são a compra: a primeira abre a posição, e
 * não há "preço médio de antes" a mostrar. `realized` é a venda — e carrega a
 * isenção, porque "−310,00 realizado" e "−310,00 realizado, isento" são
 * respostas diferentes para quem vai declarar. Provento nunca mexe no preço
 * médio, exceto a amortização, que devolve capital e reduz o custo.
 */
export const statementEffectSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('average_price'),
    before: decimalString,
    after: decimalString,
  }),
  z.object({ type: z.literal('position_opened'), avg_price: decimalString }),
  z.object({
    type: z.literal('realized'),
    result: decimalString,
    /** Dentro da isenção mensal de ações; nulo quando o recálculo ainda não gravou. */
    exempt: z.boolean().nullable(),
  }),
  z.object({ type: z.literal('payout_exempt') }),
  z.object({ type: z.literal('payout_withheld'), tax: decimalString }),
  z.object({
    type: z.literal('payout_receivable'),
    expected: decimalString.nullable(),
  }),
  z.object({ type: z.literal('cost_reduction'), amount: decimalString }),
  z.object({ type: z.literal('cash_in') }),
  z.object({ type: z.literal('cash_out') }),
  z.object({
    type: z.literal('corporate_event'),
    ratio_from: decimalString,
    ratio_to: decimalString,
    quantity_before: decimalString,
    quantity_after: decimalString,
  }),
  /** O lançamento não muda posição nem resultado. */
  z.object({ type: z.literal('none') }),
]);

export type StatementEffect = z.infer<typeof statementEffectSchema>;

export const statementRowSchema = z.object({
  id: uuid,
  kind: z.enum(TRANSACTION_KINDS),
  payout_kind: z.enum(PAYOUT_KINDS).nullable(),
  trade_date: dateOnly,
  settlement_date: dateOnly,
  portfolio_id: uuid,
  portfolio_name: z.string(),
  institution_id: uuid,
  institution_name: z.string().nullable(),
  asset_id: uuid.nullable(),
  ticker: z.string().nullable(),
  asset_name: z.string().nullable(),
  b3_type: b3TypeSchema.nullable(),
  quantity: decimalString,
  unit_price: decimalString,
  fees: decimalString,
  gross_amount: decimalString,
  tax_withheld: decimalString,
  /** Com sinal: o que entrou (+) ou saiu (−) do caixa. */
  net_amount: decimalString,
  /** Nulo enquanto o provento está "a receber". */
  confirmed_at: z.string().nullable(),
  note: z.string().nullable(),
  effect: statementEffectSchema,
});

export type StatementRow = z.infer<typeof statementRowSchema>;

/**
 * O resumo de um recorte. Compra e venda são valores em módulo — "compras R$
 * 5.721,00" —, e os sinais ficam na tabela. Provento só conta o que já foi
 * recebido: o "a receber" ainda não é dinheiro.
 */
export const statementSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  deposits: decimalString,
  withdrawals: decimalString,
  buys: decimalString,
  sells: decimalString,
  payouts: decimalString,
});

export type StatementSummary = z.infer<typeof statementSummarySchema>;

/** O subtotal de um mês do recorte, inteiro — não só da parte que cabe na página. */
export const statementMonthSchema = statementSummarySchema.extend({
  /** `AAAA-MM`. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

export type StatementMonth = z.infer<typeof statementMonthSchema>;

export const statementResourceSchema = z.object({
  scope: z.object({
    portfolio_id: uuid,
    portfolio_name: z.string().nullable(),
    /** Quantos lançamentos o escopo tem, sem filtro nenhum — o "312 desde mar/2021". */
    entries_total: z.number().int().nonnegative(),
    /** O primeiro lançamento do escopo; é o que "Início" significa no período. */
    first_trade_date: dateOnly.nullable(),
  }),
  summary: statementSummarySchema,
  facets: z.array(
    z.object({ group: statementGroupSchema, count: z.number().int().nonnegative() }),
  ),
  /** O "Todos": quantos lançamentos há sob os filtros, qualquer tipo. */
  facets_total: z.number().int().nonnegative(),
  institutions: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  months: z.array(statementMonthSchema),
  page: z.object({
    number: z.number().int().positive(),
    limit: z.number().int().positive(),
    /** Quantos lançamentos o recorte inteiro tem. */
    total: z.number().int().nonnegative(),
  }),
  rows: z.array(statementRowSchema),
  /**
   * O mês anterior ao início do período que ainda tem lançamento sob os mesmos
   * filtros — é o "Ampliar o período para agosto · 14 lançamentos". Nulo quando
   * não há mais nada para trás, e aí o link não existe.
   */
  earlier: z.object({ month: z.string(), count: z.number().int().positive() }).nullable(),
  /**
   * O recálculo muda os números da coluna Efeito, e a tela precisa dizer que
   * está acontecendo. Conta carteiras do escopo, não lançamentos.
   */
  recalculation: z.object({
    pending: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});

export type StatementResource = z.infer<typeof statementResourceSchema>;
