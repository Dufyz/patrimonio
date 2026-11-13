/**
 * NAV-12 · Todo número é um link. Esta é a única função que monta o destino de
 * um total: nenhum componente escreve a URL de uma lista à mão. O destino
 * mantém o período e o escopo do cartão de origem (RN-U16).
 */
import { filtersToParams, EMPTY_FILTERS } from './ledger_filters.js';
import { routes } from './routes.js';

export type TotalTarget =
  | { readonly kind: 'carteiras'; readonly scope?: string }
  | { readonly kind: 'contas'; readonly account?: string }
  | { readonly kind: 'faturas'; readonly card?: string; readonly invoice?: string }
  | { readonly kind: 'receitas'; readonly month?: string }
  | { readonly kind: 'despesas'; readonly month?: string }
  | { readonly kind: 'aportes'; readonly month?: string; readonly planned?: boolean }
  | { readonly kind: 'a_lancar'; readonly month?: string }
  | { readonly kind: 'categoria'; readonly category: string; readonly month?: string }
  | { readonly kind: 'classe'; readonly classId: string; readonly scope?: string }
  | { readonly kind: 'posicao'; readonly slug: string; readonly scope?: string };

/** Rótulo acessível de todo número clicável. */
export const TOTAL_LINK_LABEL = 'abrir lista';

const ledger = (
  filters: Partial<Record<'tipo' | 'situacao' | 'categoria', readonly string[]>>,
  month: string | undefined,
  extra: Readonly<Record<string, string>> = {},
): string => {
  const params = filtersToParams({ ...EMPTY_FILTERS, ...filters });
  if (month !== undefined) params.set('mes', month);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const search = params.toString();
  return search === '' ? '/lancamentos' : `/lancamentos?${search}`;
};

export const totalLink = (target: TotalTarget): string => {
  switch (target.kind) {
    case 'carteiras':
      return target.scope === undefined
        ? routes.home('investimentos')
        : routes.portfolio(target.scope, 'posicoes');
    case 'contas':
      return target.account === undefined
        ? '/contas'
        : `/contas/${encodeURIComponent(target.account)}`;
    case 'faturas':
      if (target.card === undefined) return '/cartoes';
      return target.invoice === undefined
        ? `/cartoes/${encodeURIComponent(target.card)}`
        : `/cartoes/${encodeURIComponent(target.card)}?fatura=${encodeURIComponent(target.invoice)}`;
    case 'receitas':
      return ledger({ tipo: ['RECEITA'], situacao: ['lancado'] }, target.month);
    case 'despesas':
      return ledger({ tipo: ['DESPESA'], situacao: ['lancado'] }, target.month);
    case 'aportes':
      return ledger(
        {
          tipo: ['APORTE'],
          situacao: [target.planned === true ? 'previsto' : 'lancado'],
        },
        target.month,
      );
    case 'a_lancar':
      return ledger({ situacao: ['previsto'] }, target.month);
    case 'categoria':
      return ledger({ categoria: [target.category] }, target.month, {
        agrupar: 'categoria',
      });
    case 'classe':
      return `${routes.portfolio(target.scope, 'posicoes')}?classe=${encodeURIComponent(target.classId)}`;
    case 'posicao':
      return routes.asset(target.scope ?? 'todas', target.slug);
  }
};
