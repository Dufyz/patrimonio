import { describe, expect, it } from 'vitest';

import { accountBalance, accountLines, accountsOverview } from './accounts.js';
import { benefitWarnings, syncBenefitCredits } from './benefits.js';
import { emptyEntryDraft } from './entry_ops.js';
import { indicators } from './ledger.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';

const TODAY = SEED_REFERENCE_DATE;
const data = seedData();

describe('syncBenefitCredits (RN-36)', () => {
  it('antes do dia do crédito nada muda', () => {
    expect(syncBenefitCredits(data, TODAY)).toBe(data);
    expect(syncBenefitCredits(data, '2026-11-04')).toBe(data);
  });

  it('no dia do crédito o saldo sobe e a movimentação tem a etiqueta crédito', () => {
    const next = syncBenefitCredits(data, '2026-11-05');
    expect(accountBalance(next, 'vale-alimentacao', '2026-11-05')).toBe(61240 + 110000);
    expect(accountBalance(next, 'flex', '2026-11-05')).toBe(19830 + 40000);
    const line = accountLines(next, 'flex', '2026-11-05').at(-1);
    expect(line?.tags).toEqual(['crédito']);
    expect(line?.date).toBe('2026-11-05');
    expect(line?.cents).toBe(40000);
  });

  it('é idempotente: repetir não duplica', () => {
    const once = syncBenefitCredits(data, '2026-11-05');
    expect(syncBenefitCredits(once, '2026-11-05')).toBe(once);
    expect(syncBenefitCredits(once, '2026-11-20')).toBe(once);
  });

  it('meses perdidos são creditados de uma vez', () => {
    const next = syncBenefitCredits(data, '2027-01-10');
    expect(
      next.movements.filter((m) => m.kind === 'credito' && m.accountId === 'flex'),
    ).toHaveLength(3);
  });

  it('o crédito não é receita, não aparece em Lançamentos e não entra em Em contas', () => {
    const next = syncBenefitCredits(data, '2026-11-05');
    const range = { from: '2026-11-01', to: '2026-11-30' };
    expect(next.entries).toBe(data.entries);
    expect(
      indicators(
        next.entries.filter((e) => e.historical !== true),
        range,
      ).receitas.cents,
    ).toBe(0);
    expect(accountsOverview(next, range, '2026-11-05').totalBalance).toBe(
      accountsOverview(data, range, '2026-11-05').totalBalance,
    );
  });

  it('mês curto cai no último dia e conta arquivada não recebe', () => {
    const short = {
      ...data,
      accounts: data.accounts.map((a) =>
        a.id === 'flex' ? { ...a, creditDay: 31, creditsFrom: '2027-02-01' } : a,
      ),
    };
    const next = syncBenefitCredits(short, '2027-02-28');
    expect(next.movements.find((m) => m.id === 'credit:flex:2027-02')?.date).toBe(
      '2027-02-28',
    );
    const archived = {
      ...short,
      accounts: short.accounts.map((a) =>
        a.id === 'flex' ? { ...a, archived: true } : a,
      ),
    };
    expect(
      syncBenefitCredits(archived, '2027-02-28').movements.some(
        (m) => m.accountId === 'flex' && m.kind === 'credito',
      ),
    ).toBe(false);
  });
});

describe('benefitWarnings (FIN-408)', () => {
  const draft = {
    ...emptyEntryDraft(TODAY),
    description: 'Conta de água',
    categoryId: 'moradia',
    value: '250,00',
    sourceId: 'flex',
  };

  it('parte maior que o saldo do benefício avisa', () => {
    expect(benefitWarnings(data, draft, TODAY)).toEqual([
      'Flex tem R$ 198,30 de saldo e esta parte é de R$ 250,00.',
    ]);
  });

  it('parte dentro do saldo não avisa; conta e cartão nunca avisam', () => {
    expect(benefitWarnings(data, { ...draft, value: '198,30' }, TODAY)).toEqual([]);
    expect(benefitWarnings(data, { ...draft, sourceId: 'itau-corrente' }, TODAY)).toEqual(
      [],
    );
    expect(benefitWarnings(data, { ...draft, sourceId: 'itau-visa' }, TODAY)).toEqual([]);
  });

  it('compara só a parte do benefício numa despesa dividida (CE-03)', () => {
    const split = {
      ...draft,
      value: '200,00',
      split: true,
      firstValue: '120,00',
      secondSourceId: 'itau-corrente',
      secondValue: '80,00',
    };
    expect(benefitWarnings(data, split, TODAY)).toEqual([]);
    expect(
      benefitWarnings(
        data,
        { ...split, firstValue: '210,00', secondValue: '0,00' },
        TODAY,
      ),
    ).toHaveLength(1);
  });

  it('ao editar, a parte antiga volta ao saldo antes de comparar', () => {
    const luz = {
      ...emptyEntryDraft(TODAY),
      kind: 'despesa' as const,
      value: '312,40',
      split: true,
      sourceId: 'flex',
      firstValue: '340,00',
      secondSourceId: 'itau-corrente',
      secondValue: '0,00',
    };
    expect(benefitWarnings(data, luz, TODAY)).toHaveLength(1);
    // 198,30 + 150,00 já descontados = 348,30 disponíveis ao editar a conta de luz
    expect(benefitWarnings(data, luz, TODAY, 'l-luz')).toEqual([]);
  });

  it('receita não avisa', () => {
    expect(benefitWarnings(data, { ...draft, kind: 'receita' }, TODAY)).toEqual([]);
  });
});
