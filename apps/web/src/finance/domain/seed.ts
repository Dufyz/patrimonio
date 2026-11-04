import { addMonths, startOfMonth } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import type { Cents } from '../lib/money.js';
import type {
  Account,
  Category,
  Entry,
  EntryKind,
  FinanceData,
  Movement,
  Payment,
  Recurring,
} from './types.js';

/**
 * A semente: os números das pranchas, desenhadas em 24/10/2026.
 *
 * É o que a aplicação mostra até o usuário cadastrar os próprios dados. A
 * história que consumir uma parte nova (recorrentes, contas, cartões) acrescenta
 * a dela aqui.
 */

/** Muda quando a semente muda de forma que dados antigos não servem mais. */
export const SEED_VERSION = 3;

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
    id: 'l-aluguel-nov',
    date: '2026-11-10',
    description: 'Aluguel e condomínio',
    categoryId: 'moradia',
    cents: 320000,
    status: 'prevista',
    recurringId: 'r-aluguel',
    payments: [pay('itau-corrente', 320000)],
  }),
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
    recurringId: 'r-reembolso',
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
    recurringId: 'r-freela',
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

const recurring = (
  id: string,
  name: string,
  kind: EntryKind,
  categoryId: string,
  sourceId: string,
  day: number,
  mode: 'automatico' | 'manual',
  cents: Cents,
  active = true,
): Recurring => ({ id, name, kind, categoryId, sourceId, day, mode, cents, active });

/** Prancha 05: 15 ativos e 1 pausado. */
export const SEED_RECURRINGS: readonly Recurring[] = [
  recurring(
    'r-salario',
    'Salário',
    'receita',
    'salario',
    'itau-corrente',
    5,
    'automatico',
    1420000,
  ),
  recurring(
    'r-freela',
    'Freela · Projeto Lume',
    'receita',
    'freelas',
    'itau-corrente',
    12,
    'manual',
    180000,
  ),
  recurring(
    'r-reembolso',
    'Reembolso da empresa',
    'receita',
    'reembolso',
    'itau-corrente',
    15,
    'manual',
    35000,
  ),
  recurring(
    'r-plano-saude',
    'Plano de saúde',
    'despesa',
    'saude',
    'itau-corrente',
    5,
    'automatico',
    61200,
  ),
  recurring(
    'r-plano-vida',
    'Plano de vida',
    'despesa',
    'saude',
    'itau-corrente',
    5,
    'automatico',
    18990,
  ),
  recurring(
    'r-aluguel',
    'Aluguel e condomínio',
    'despesa',
    'moradia',
    'itau-corrente',
    10,
    'automatico',
    320000,
  ),
  recurring(
    'r-academia',
    'Academia',
    'despesa',
    'saude',
    'itau-visa',
    10,
    'automatico',
    10390,
  ),
  recurring(
    'r-seguro-carro',
    'Seguro do carro',
    'despesa',
    'transporte',
    'itau-corrente',
    15,
    'automatico',
    45400,
  ),
  recurring(
    'r-internet',
    'Internet',
    'despesa',
    'moradia',
    'itau-corrente',
    15,
    'automatico',
    5000,
  ),
  {
    ...recurring(
      'r-luz',
      'Conta de luz',
      'despesa',
      'moradia',
      'flex',
      17,
      'manual',
      31240,
    ),
    secondSourceId: 'itau-corrente',
    coversUpTo: 15000,
  },
  recurring(
    'r-netflix',
    'Netflix',
    'despesa',
    'assinaturas',
    'itau-visa',
    20,
    'automatico',
    5590,
  ),
  recurring(
    'r-investimento',
    'Investimento',
    'despesa',
    'investimento',
    'itau-corrente',
    21,
    'manual',
    450000,
  ),
  recurring(
    'r-spotify',
    'Spotify',
    'despesa',
    'assinaturas',
    'itau-visa',
    30,
    'automatico',
    2190,
  ),
  recurring(
    'r-gasto-livre',
    'Gasto livre',
    'despesa',
    'gasto-livre',
    'nubank-conta',
    31,
    'manual',
    470000,
  ),
  recurring(
    'r-investimento-fim',
    'Investimento',
    'despesa',
    'investimento',
    'itau-corrente',
    31,
    'manual',
    215000,
  ),
  recurring(
    'r-seguro-res',
    'Seguro residencial',
    'despesa',
    'moradia',
    'itau-visa',
    12,
    'manual',
    118000,
    false,
  ),
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

/**
 * Prancha 03: saldos de 24/10/2026. Cada saldo inicial é o de 01/10; as
 * movimentações abaixo e os lançamentos fecham o saldo da prancha (RN-31).
 */
export const SEED_ACCOUNTS: readonly Account[] = [
  {
    id: 'itau-corrente',
    name: 'Itaú Corrente',
    role: 'Recebe as receitas e paga as despesas',
    roleTag: 'recebe receitas e paga despesas',
    institution: 'Itaú Unibanco',
    type: 'conta',
    initialCents: 213355,
  },
  {
    id: 'nubank-conta',
    name: 'Nubank Conta',
    role: 'Saldo livre para gastar no mês',
    roleTag: 'recebe o saldo livre e paga a fatura',
    institution: 'Nubank',
    type: 'conta',
    initialCents: 776600,
  },
  {
    id: 'carteira',
    name: 'Carteira',
    role: 'Dinheiro em espécie',
    roleTag: 'dinheiro em espécie',
    type: 'conta',
    initialCents: 30000,
  },
  {
    id: 'vale-alimentacao',
    name: 'Vale Alimentação',
    role: 'Mercado e restaurantes',
    roleTag: 'mercado e restaurantes',
    type: 'beneficio',
    initialCents: 61240,
    creditCents: 110000,
    creditDay: 5,
    creditsFrom: '2026-11-01',
  },
  {
    id: 'flex',
    name: 'Flex',
    role: 'Conta de luz e o que você definir nas recorrentes',
    roleTag: 'conta de luz e recorrentes',
    type: 'beneficio',
    initialCents: 34830,
    creditCents: 40000,
    creditDay: 5,
    creditsFrom: '2026-11-01',
  },
];

/**
 * A transferência do saldo livre (4.700,00), os pagamentos das faturas de
 * setembro e o ajuste da Carteira (−60,00 na prancha, sem lançamento por trás).
 */
export const SEED_MOVEMENTS: readonly Movement[] = [
  {
    id: 'm-saldo-livre-saida',
    date: '2026-10-05',
    accountId: 'itau-corrente',
    kind: 'transferencia',
    cents: -470000,
    description: 'Transferência para Nubank Conta',
    note: 'saldo livre do mês',
    transferId: 'm-saldo-livre',
  },
  {
    id: 'm-saldo-livre-entrada',
    date: '2026-10-05',
    accountId: 'nubank-conta',
    kind: 'transferencia',
    cents: 470000,
    description: 'Transferência de Itaú Corrente',
    note: 'saldo livre do mês',
    transferId: 'm-saldo-livre',
  },
  {
    id: 'm-fatura-nubank-set',
    date: '2026-10-05',
    accountId: 'nubank-conta',
    kind: 'fatura',
    cents: -404565,
    description: 'Pagamento da fatura Nubank Mastercard (set)',
  },
  {
    id: 'm-fatura-itau-set',
    date: '2026-10-08',
    accountId: 'itau-corrente',
    kind: 'fatura',
    cents: -150245,
    description: 'Pagamento da fatura Itaú Visa (set)',
  },
  {
    id: 'm-carteira-ajuste',
    date: '2026-10-09',
    accountId: 'carteira',
    kind: 'ajuste',
    cents: -6000,
    description: 'Ajuste de saldo',
    note: 'diferença apurada na conferência',
  },
];

export const seedData = (): FinanceData => ({
  accounts: SEED_ACCOUNTS,
  movements: SEED_MOVEMENTS,
  categories: SEED_CATEGORIES,
  recurrings: SEED_RECURRINGS,
  entries: [...OCTOBER, ...history(SEED_REFERENCE_DATE)],
});
