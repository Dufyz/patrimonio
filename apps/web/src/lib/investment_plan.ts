/**
 * Projeção de Investimentos: de hoje em diante, quanto cada carteira vale se o
 * plano de aportes for seguido.
 *
 * O plano diz **quanto entra em cada carteira por mês**: regras de valor fixo,
 * a partir de um mês e até outro. Cada carteira tem a sua rentabilidade
 * esperada ao ano. Nada aqui vem de Finanças: são áreas separadas.
 *
 * Em centavos inteiros e meses `AAAA-MM`, sem relógio e sem rede. É leitura:
 * nada daqui grava aporte, só mostra o que o plano produziria.
 */

export type Cents = number;

export const MAX_RATE = 10_000;

export type PlanRule = {
  readonly id: string;
  readonly portfolioId: string;
  /** Centavos por mês. */
  readonly cents: Cents;
  /** Primeiro mês em que vale. */
  readonly from: string;
  /** Último mês em que vale; `null` é sem fim. */
  readonly until: string | null;
};

export type InvestmentPlan = {
  readonly rules: readonly PlanRule[];
  /** Rentabilidade esperada ao ano por carteira, em centésimos de ponto percentual (`1375` = 13,75%). */
  readonly rates: Readonly<Record<string, number>>;
};

export const EMPTY_PLAN: InvestmentPlan = { rules: [], rates: {} };

export type PortfolioStart = {
  readonly id: string;
  readonly name: string;
  /** O valor de hoje. */
  readonly cents: Cents;
};

export type PlanMonth = {
  readonly key: string;
  /** Aporte, rendimento e valor ao fim do mês, por carteira. */
  readonly aporte: Readonly<Record<string, Cents>>;
  readonly rendimento: Readonly<Record<string, Cents>>;
  readonly end: Readonly<Record<string, Cents>>;
  readonly totalAporte: Cents;
  readonly totalRendimento: Cents;
  readonly totalEnd: Cents;
};

export const monthAfter = (key: string, count: number): string => {
  const [year = 0, month = 1] = key.split('-').map(Number);
  const index = year * 12 + (month - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};

export const isMonth = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const active = (rule: PlanRule, key: string): boolean =>
  key >= rule.from && (rule.until === null || key <= rule.until);

/**
 * Projeta `months` meses a partir de `firstMonth`. No mês, a carteira rende
 * primeiro e o aporte entra no fim, o que subestima um pouco o rendimento do
 * mês de aporte em vez de superestimar.
 */
export const projectInvestments = (
  starts: readonly PortfolioStart[],
  plan: InvestmentPlan,
  firstMonth: string,
  months: number,
): readonly PlanMonth[] => {
  const values = new Map(starts.map((p) => [p.id, p.cents]));
  const rows: PlanMonth[] = [];

  for (let index = 0; index < months; index += 1) {
    const key = monthAfter(firstMonth, index);
    const aporte: Record<string, Cents> = {};
    const rendimento: Record<string, Cents> = {};
    const end: Record<string, Cents> = {};

    for (const start of starts) {
      const rate = (plan.rates[start.id] ?? 0) / 10_000;
      const before = values.get(start.id) ?? 0;
      const gain = rate === 0 ? 0 : Math.round(before * (Math.pow(1 + rate, 1 / 12) - 1));
      const put = plan.rules
        .filter((rule) => rule.portfolioId === start.id && active(rule, key))
        .reduce((acc, rule) => acc + rule.cents, 0);
      const after = before + gain + put;
      values.set(start.id, after);
      aporte[start.id] = put;
      rendimento[start.id] = gain;
      end[start.id] = after;
    }

    const sum = (record: Readonly<Record<string, Cents>>): Cents =>
      Object.values(record).reduce((acc, value) => acc + value, 0);
    rows.push({
      key,
      aporte,
      rendimento,
      end,
      totalAporte: sum(aporte),
      totalRendimento: sum(rendimento),
      totalEnd: sum(end),
    });
  }
  return rows;
};

/** `13,75` → `1375`; vazio é zero; recusa mais de duas casas e acima de 100%. */
export const parseRate = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(trimmed);
  if (match === null) return null;
  const rate = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return rate <= MAX_RATE ? rate : null;
};

/** `1375` → `13,75`; `1300` → `13`; `1350` → `13,5`. */
export const formatRate = (rate: number): string =>
  (rate / 100).toFixed(2).replace('.', ',').replace(/,?0+$/, '');

/** `1.250,50` ou `1250.5` → centavos; recusa zero, negativo e lixo. */
export const parseMoneyText = (text: string): Cents | null => {
  const cleaned = text.trim().replace(/\s|R\$/g, '');
  if (cleaned === '') return null;
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return cents > 0 ? cents : null;
};

const windowErrors = (
  draft: { readonly from: string; readonly until: string },
  errors: Record<string, string>,
): void => {
  if (!isMonth(draft.from)) errors['from'] = 'Informe o mês em que começa.';
  if (draft.until !== '' && !isMonth(draft.until)) errors['until'] = 'Mês inválido.';
  else if (draft.until !== '' && isMonth(draft.from) && draft.until < draft.from) {
    errors['until'] = 'O fim não pode ser antes do começo.';
  }
};

export type RuleDraft = {
  readonly portfolioId: string;
  readonly value: string;
  readonly from: string;
  readonly until: string;
};

export type RuleErrors = Partial<Record<keyof RuleDraft, string>>;

export const validateRule = (
  draft: RuleDraft,
  portfolioIds: readonly string[],
): RuleErrors => {
  const errors: Record<string, string> = {};
  if (!portfolioIds.includes(draft.portfolioId)) {
    errors['portfolioId'] = 'Escolha a carteira.';
  }
  if (parseMoneyText(draft.value) === null) {
    errors['value'] = 'Informe um valor maior que zero.';
  }
  windowErrors(draft, errors);
  return errors;
};

export const ruleOfDraft = (draft: RuleDraft, id: string): PlanRule => ({
  id,
  portfolioId: draft.portfolioId,
  cents: parseMoneyText(draft.value) ?? 0,
  from: draft.from,
  until: draft.until === '' ? null : draft.until,
});
