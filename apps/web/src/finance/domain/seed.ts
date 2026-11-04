import { addMonths, startOfMonth } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import type { Cents } from '../lib/money.js';
import type { Category, Entry, EntryKind, FinanceData, Payment } from './types.js';

/**
 * A semente: os números das pranchas, desenhadas em 24/10/2026.
 *
 * É o que a aplicação mostra até o usuário cadastrar os próprios dados. A
 * história que consumir uma parte nova (recorrentes, contas, cartões) acrescenta
 * a dela aqui.
 */

/** Muda quando a semente muda de forma que dados antigos não servem mais. */
export const SEED_VERSION = 1;

const category = (
  id: string,
  name: string,
  kind: EntryKind,
  color: string,
): Category => ({ id, name, kind, color });

export const SEED_CATEGORIES: readonly Category[] = [
  category('moradia', 'Moradia', 'despesa', 'slate'),
  category('saude', 'Saúde', 'despesa', 'rose'),
  category('transporte', 'Transporte', 'despesa', 'blue'),
  category('assinaturas', 'Assinaturas', 'despesa', 'brown'),
  category('investimento', 'Investimento', 'despesa', 'violet'),
  category('gasto-livre', 'Gasto livre', 'despesa', 'teal'),
  category('mercado', 'Mercado', 'despesa', 'orange'),
  category('restaurantes', 'Restaurantes', 'despesa', 'orange'),
  category('eletronicos', 'Eletrônicos', 'despesa', 'green'),
  category('lazer', 'Lazer', 'despesa', 'indigo'),
  category('educacao', 'Educação', 'despesa', 'olive'),
  category('viagem', 'Viagem', 'despesa', 'cyan'),
  category('salario', 'Salário', 'receita', 'olive'),
  category('freelas', 'Freelas', 'receita', 'cyan'),
  category('reembolso', 'Reembolso', 'receita', 'gray'),
];

/** Média mensal dos 12 meses anteriores, por categoria, como na prancha 06. */
const MONTHLY_HISTORY: Readonly<Record<string, Cents>> = {
  moradia: 341000,
  saude: 88015,
  transporte: 51230,
  assinaturas: 7780,
  investimento: 620000,
  'gasto-livre': 465000,
  mercado: 148235,
  restaurantes: 64000,
  eletronicos: 31000,
  lazer: 28000,
  educacao: 19000,
  viagem: 42000,
  salario: 1420000,
  freelas: 145000,
  reembolso: 12000,
};

const pay = (sourceId: string, cents: Cents): Payment => ({ sourceId, cents });

type Draft = {
  readonly id: string;
  readonly date: IsoDate;
  readonly description: string;
  readonly categoryId: string;
  readonly cents: Cents;
  readonly status: 'prevista' | 'lancada';
  readonly recurringId?: string;
  readonly payments: readonly Payment[];
};

const entry = (kind: EntryKind, draft: Draft): Entry => ({ kind, ...draft });

/** Outubro de 2026, prancha 02A. */
const OCTOBER: readonly Entry[] = [
  entry('despesa', {
    id: 'l-spotify',
    date: '2026-10-30',
    description: 'Spotify',
    categoryId: 'assinaturas',
    cents: 2190,
    status: 'prevista',
    recurringId: 'r-spotify',
    payments: [pay('itau-visa', 2190)],
  }),
  entry('despesa', {
    id: 'l-gasto-livre',
    date: '2026-10-31',
    description: 'Gasto livre',
    categoryId: 'gasto-livre',
    cents: 470000,
    status: 'prevista',
    recurringId: 'r-gasto-livre',
    payments: [pay('nubank-conta', 470000)],
  }),
  entry('despesa', {
    id: 'l-investimento-fim',
    date: '2026-10-31',
    description: 'Investimento',
    categoryId: 'investimento',
    cents: 215000,
    status: 'prevista',
    recurringId: 'r-investimento-fim',
    payments: [pay('itau-corrente', 215000)],
  }),
  entry('despesa', {
    id: 'l-investimento',
    date: '2026-10-21',
    description: 'Investimento',
    categoryId: 'investimento',
    cents: 450000,
    status: 'lancada',
    recurringId: 'r-investimento',
    payments: [pay('itau-corrente', 450000)],
  }),
  entry('despesa', {
    id: 'l-netflix',
    date: '2026-10-20',
    description: 'Netflix',
    categoryId: 'assinaturas',
    cents: 5590,
    status: 'lancada',
    recurringId: 'r-netflix',
    payments: [pay('itau-visa', 5590)],
  }),
  entry('despesa', {
    id: 'l-luz',
    date: '2026-10-17',
    description: 'Conta de luz',
    categoryId: 'moradia',
    cents: 31240,
    status: 'lancada',
    recurringId: 'r-luz',
    payments: [pay('flex', 15000), pay('itau-corrente', 16240)],
  }),
  entry('receita', {
    id: 'l-reembolso',
    date: '2026-10-15',
    description: 'Reembolso da empresa',
    categoryId: 'reembolso',
    cents: 35000,
    status: 'lancada',
    payments: [pay('itau-corrente', 35000)],
  }),
  entry('despesa', {
    id: 'l-seguro-carro',
    date: '2026-10-15',
    description: 'Seguro do carro',
    categoryId: 'transporte',
    cents: 45400,
    status: 'lancada',
    recurringId: 'r-seguro-carro',
    payments: [pay('itau-corrente', 45400)],
  }),
  entry('despesa', {
    id: 'l-internet',
    date: '2026-10-15',
    description: 'Internet',
    categoryId: 'moradia',
    cents: 5000,
    status: 'lancada',
    recurringId: 'r-internet',
    payments: [pay('itau-corrente', 5000)],
  }),
  entry('receita', {
    id: 'l-freela',
    date: '2026-10-12',
    description: 'Freela · Projeto Lume',
    categoryId: 'freelas',
    cents: 180000,
    status: 'lancada',
    payments: [pay('itau-corrente', 180000)],
  }),
  entry('despesa', {
    id: 'l-aluguel',
    date: '2026-10-10',
    description: 'Aluguel e condomínio',
    categoryId: 'moradia',
    cents: 320000,
    status: 'lancada',
    recurringId: 'r-aluguel',
    payments: [pay('itau-corrente', 320000)],
  }),
  entry('despesa', {
    id: 'l-academia',
    date: '2026-10-10',
    description: 'Academia',
    categoryId: 'saude',
    cents: 10390,
    status: 'lancada',
    recurringId: 'r-academia',
    payments: [pay('itau-visa', 10390)],
  }),
  entry('receita', {
    id: 'l-salario',
    date: '2026-10-05',
    description: 'Salário',
    categoryId: 'salario',
    cents: 1420000,
    status: 'lancada',
    recurringId: 'r-salario',
    payments: [pay('itau-corrente', 1420000)],
  }),
  entry('despesa', {
    id: 'l-plano-saude',
    date: '2026-10-05',
    description: 'Plano de saúde',
    categoryId: 'saude',
    cents: 61200,
    status: 'lancada',
    recurringId: 'r-plano-saude',
    payments: [pay('itau-corrente', 61200)],
  }),
  entry('despesa', {
    id: 'l-plano-vida',
    date: '2026-10-05',
    description: 'Plano de vida',
    categoryId: 'saude',
    cents: 18990,
    status: 'lancada',
    recurringId: 'r-plano-vida',
    payments: [pay('itau-corrente', 18990)],
  }),
];

/**
 * Os 12 meses anteriores: um lançado por categoria e mês, no valor da média da
 * prancha. É histórico — conta nas médias, não move saldo (`historical`).
 */
const history = (today: IsoDate): readonly Entry[] =>
  SEED_CATEGORIES.flatMap((cat) =>
    Array.from({ length: 12 }, (_, index) => {
      const date = startOfMonth(addMonths(today, -(index + 1)));
      return {
        id: `h-${cat.id}-${date.slice(0, 7)}`,
        kind: cat.kind,
        date,
        description: `${cat.name} · histórico`,
        categoryId: cat.id,
        cents: MONTHLY_HISTORY[cat.id] ?? 0,
        status: 'lancada' as const,
        payments: [],
        historical: true as const,
      };
    }),
  );

/** A data de referência das pranchas; o histórico é contado a partir dela. */
export const SEED_REFERENCE_DATE: IsoDate = '2026-10-24';

export const seedData = (): FinanceData => ({
  categories: SEED_CATEGORIES,
  entries: [...OCTOBER, ...history(SEED_REFERENCE_DATE)],
});
