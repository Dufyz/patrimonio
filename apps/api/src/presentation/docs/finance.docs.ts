import * as c from '@patrimonio/contracts';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Finanças';
const READ = { description: 'Leitura.', schema: c.finReadResponseSchema };
const WROTE = {
  description:
    'Gravado, com o efeito antes → depois. `?preview=true` devolve só o efeito, sem gravar.',
  schema: c.finWriteResponseSchema,
};
const MADE = {
  description: 'Criado, com o efeito antes → depois.',
  schema: c.finWriteResponseSchema,
};
const RULE = {
  description:
    'Regra de negócio violada: o corpo traz `code` estável (`ENTRY_SPLIT_MISMATCH`, `INSTALLMENT_SCOPE_REQUIRED`, `INVOICE_OVERPAYMENT`…).',
  schema: c.finErrorResponseSchema,
};
const MISSING = { description: 'Não encontrado.', schema: c.finErrorResponseSchema };
const CONFLICT = {
  description: '`If-Match` com versão velha, ou item em uso (`*_IN_USE`).',
  schema: c.finErrorResponseSchema,
};

type Entry = readonly [
  RouteDoc['method'],
  string,
  string,
  RouteDoc['request'],
  RouteDoc['responses'],
];

const rows: readonly Entry[] = [
  [
    'get',
    '/finance/snapshot',
    'Tudo que Finanças guarda numa foto só (o front monta as telas a partir dela)',
    c.finSnapshotSchema,
    { 200: READ },
  ],
  [
    'get',
    '/finance/forecast',
    'Saldo previsto numa data (Em contas + previstos − aportes previstos − faturas) e a série com o menor saldo',
    c.finForecastSchema,
    { 200: READ },
  ],
  [
    'get',
    '/finance/wealth',
    'Patrimônio total (Em carteiras + Em contas) e Livre após faturas, de uma leitura só',
    c.finWealthSchema,
    { 200: READ },
  ],
  [
    'get',
    '/finance/book',
    'Livro unificado: Finanças e carteiras com filtros por tipo, situação, conta, carteira, ativo e classe; totais independem da página',
    c.listBookSchema,
    { 200: READ },
  ],
  [
    'get',
    '/finance/overview',
    'Visão geral do mês: indicadores, 12 meses, vencimentos e pendências',
    c.finOverviewSchema,
    { 200: READ },
  ],
  [
    'get',
    '/finance/search',
    'Busca em lançamentos, contas, cartões, categorias e recorrentes',
    c.finSearchSchema,
    { 200: READ },
  ],
  [
    'post',
    '/finance/jobs/sync',
    'Gera previstos, lança automáticos (a rotina diária, sob demanda)',
    c.syncFinanceSchema,
    { 200: WROTE },
  ],
  ['get', '/finance/categories', 'Categorias', c.listFinCategoriesSchema, { 200: READ }],
  [
    'get',
    '/finance/categories/breakdown',
    'Participação por categoria no período, com comparação',
    c.categoryBreakdownSchema,
    { 200: READ },
  ],
  [
    'post',
    '/finance/categories',
    'Criar categoria',
    c.createFinCategorySchema,
    { 201: MADE, 422: RULE },
  ],
  [
    'put',
    '/finance/categories/:id',
    'Editar categoria (`If-Match`)',
    c.updateFinCategorySchema,
    { 200: WROTE, 404: MISSING, 409: CONFLICT, 422: RULE },
  ],
  [
    'post',
    '/finance/categories/:id/archive',
    'Arquivar ou reativar categoria',
    c.archiveFinCategorySchema,
    { 200: WROTE, 404: MISSING },
  ],
  [
    'delete',
    '/finance/categories/:id',
    'Excluir categoria sem uso',
    c.deleteFinCategorySchema,
    { 200: WROTE, 404: MISSING, 409: CONFLICT },
  ],
  [
    'get',
    '/finance/accounts',
    'Contas, com saldo e variação do período',
    c.listAccountsSchema,
    { 200: READ },
  ],
  [
    'get',
    '/finance/accounts/:id/statement',
    'Extrato da conta: abertura + entradas − saídas = fechamento',
    c.statementSchema,
    { 200: READ, 404: MISSING },
  ],
  [
    'post',
    '/finance/accounts',
    'Criar conta',
    c.createAccountSchema,
    { 201: MADE, 422: RULE },
  ],
  [
    'put',
    '/finance/accounts/:id',
    'Editar conta (`If-Match`)',
    c.updateAccountSchema,
    { 200: WROTE, 404: MISSING, 409: CONFLICT, 422: RULE },
  ],
  [
    'post',
    '/finance/accounts/:id/archive',
    'Arquivar ou reativar conta',
    c.archiveAccountSchema,
    { 200: WROTE, 404: MISSING },
  ],
  [
    'delete',
    '/finance/accounts/:id',
    'Excluir conta sem uso',
    c.deleteAccountSchema,
    { 200: WROTE, 404: MISSING, 409: CONFLICT },
  ],
  [
    'post',
    '/finance/transfers',
    'Transferir entre contas (duas pernas, nunca receita/despesa)',
    c.createTransferSchema,
    { 201: MADE, 422: RULE },
  ],
  [
    'put',
    '/finance/transfers/:id',
    'Editar transferência',
    c.updateTransferSchema,
    { 200: WROTE, 404: MISSING, 422: RULE },
  ],
  [
    'delete',
    '/finance/transfers/:id',
    'Excluir transferência',
    c.deleteTransferSchema,
    { 200: WROTE, 404: MISSING },
  ],
  [
    'get',
    '/finance/cards',
    'Cartões, fatura vigente, uso do limite e próximas faturas',
    c.listCardsSchema,
    { 200: READ },
  ],
  [
    'get',
    '/finance/cards/:id/invoices/:month',
    'Fatura: linhas por bloco, totais, pagamentos',
    c.invoiceSchema,
    { 200: READ, 404: MISSING },
  ],
  [
    'post',
    '/finance/cards/:id/invoices/:month/payments',
    'Pagar fatura (parcial permitido; excesso recusado)',
    c.payInvoiceSchema,
    { 201: MADE, 422: RULE },
  ],
  [
    'post',
    '/finance/cards/:id/items',
    'Crédito ou encargo na fatura',
    c.createCardItemSchema,
    { 201: MADE, 422: RULE },
  ],
  [
    'post',
    '/finance/cards',
    'Criar cartão',
    c.createCardSchema,
    { 201: MADE, 422: RULE },
  ],
  [
    'put',
    '/finance/cards/:id',
    'Editar cartão (`If-Match`)',
    c.updateCardSchema,
    { 200: WROTE, 404: MISSING, 409: CONFLICT, 422: RULE },
  ],
  [
    'post',
    '/finance/cards/:id/archive',
    'Arquivar ou reativar cartão',
    c.archiveCardSchema,
    { 200: WROTE, 404: MISSING },
  ],
  [
    'delete',
    '/finance/cards/:id',
    'Excluir cartão sem uso',
    c.deleteCardSchema,
    { 200: WROTE, 404: MISSING, 409: CONFLICT },
  ],
  [
    'delete',
    '/finance/payments/:payment_id',
    'Excluir pagamento de fatura (reabre a fatura)',
    c.deleteInvoicePaymentSchema,
    { 200: WROTE, 404: MISSING },
  ],
  [
    'post',
    '/finance/entries/:id/invoice',
    'Mover a parte no cartão de um lançamento para outra fatura',
    c.moveEntryInvoiceSchema,
    { 200: WROTE, 404: MISSING, 422: RULE },
  ],
  [
    'post',
    '/finance/card-items/:item_id/invoice',
    'Mover um item para outra fatura',
    c.moveCardItemInvoiceSchema,
    { 200: WROTE, 404: MISSING, 422: RULE },
  ],
  [
    'delete',
    '/finance/card-items/:item_id',
    'Excluir item de fatura',
    c.deleteCardItemSchema,
    { 200: WROTE, 404: MISSING },
  ],
  ['get', '/finance/recurrings', 'Recorrentes', c.listRecurringsSchema, { 200: READ }],
  [
    'post',
    '/finance/recurrings',
    'Criar recorrente (gera o previsto do mês)',
    c.createRecurringSchema,
    { 201: MADE, 422: RULE },
  ],
  [
    'put',
    '/finance/recurrings/:id',
    'Editar recorrente; atualiza os previstos pendentes (`pending_changes`)',
    c.updateRecurringSchema,
    { 200: WROTE, 404: MISSING, 409: CONFLICT, 422: RULE },
  ],
  [
    'post',
    '/finance/recurrings/:id/active',
    'Ativar ou desativar recorrente',
    c.recurringActiveSchema,
    { 200: WROTE, 404: MISSING },
  ],
  [
    'post',
    '/finance/recurrings/:id/skip',
    'Pular um mês',
    c.skipRecurringSchema,
    { 200: WROTE, 404: MISSING },
  ],
  [
    'delete',
    '/finance/recurrings/:id',
    'Excluir recorrente (lançados permanecem)',
    c.deleteRecurringSchema,
    { 200: WROTE, 404: MISSING },
  ],
  [
    'get',
    '/finance/entries',
    'Lançamentos: indicadores, linhas, grupos e cursor',
    c.listEntriesSchema,
    { 200: READ },
  ],
  [
    'get',
    '/finance/entries/export',
    'Exportar lançamentos filtrados em CSV (`;`, vírgula decimal, UTF-8 com BOM)',
    c.exportEntriesSchema,
    { 200: { description: 'CSV.' } },
  ],
  [
    'get',
    '/finance/entries/:id',
    'Um lançamento',
    c.getEntrySchema,
    { 200: READ, 404: MISSING },
  ],
  [
    'post',
    '/finance/entries',
    'Criar lançamento (parcelado gera N parcelas)',
    c.createEntrySchema,
    { 201: MADE, 422: RULE },
  ],
  [
    'put',
    '/finance/entries/:id',
    'Editar lançamento; parcelado exige `scope` (`If-Match`)',
    c.updateEntrySchema,
    { 200: WROTE, 404: MISSING, 409: CONFLICT, 422: RULE },
  ],
  [
    'post',
    '/finance/entries/:id/confirm',
    'Confirmar previsto (idempotente)',
    c.confirmEntrySchema,
    { 200: WROTE, 404: MISSING, 422: RULE },
  ],
  [
    'delete',
    '/finance/entries/:id',
    'Excluir lançamento; parcelado exige `?scope=`',
    c.deleteEntrySchema,
    { 200: WROTE, 404: MISSING, 422: RULE },
  ],
];

export const FINANCE_ROUTE_DOCS: readonly RouteDoc[] = rows.map(
  ([method, path, summary, request, responses]) => ({
    method,
    path,
    tag: TAG,
    summary,
    request,
    responses,
  }),
);
