import { describe, expect, it } from 'vitest';

import { monthFlow } from './cash_flow.js';
import { addEntry, emptyEntryDraft } from './entry_ops.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';

/**
 * QUA-001 e QUA-003 · Os cenários de consistência entre Geral e Finanças
 * (CG-02 a CG-04): o mesmo lançamento mexe nos mesmos números das duas áreas,
 * e cada efeito aparece onde deve e só onde deve.
 */
const data = seedData();
const TODAY = SEED_REFERENCE_DATE;

const conta = data.accounts[0];
const cartao = data.cards[0];
if (conta === undefined || cartao === undefined)
  throw new Error('a semente precisa de conta e cartão');

const base = (over: Record<string, unknown>) => ({
  ...emptyEntryDraft(TODAY),
  description: 'Cenário',
  categoryId: 'mercado',
  value: '100,00',
  sourceId: conta.id,
  ...over,
});

const antes = monthFlow(data, TODAY);

/** O último dia do mês de hoje, e um dia entre hoje e ele. */
const FIM = antes.monthEnd;

describe('CG-02 · despesa lançada hoje na conta', () => {
  const depois = monthFlow(addEntry(data, base({}), TODAY), TODAY);

  it('tira o valor de Em contas hoje e do saldo previsto', () => {
    expect(depois.emContasCents).toBe(antes.emContasCents - 10000);
    expect(depois.saldoPrevistoCents).toBe(antes.saldoPrevistoCents - 10000);
  });

  it('entra em despesas lançadas, e não nas previstas', () => {
    expect(depois.despesasRealizadasCents).toBe(antes.despesasRealizadasCents + 10000);
    expect(depois.despesasPrevistasCents).toBe(antes.despesasPrevistasCents);
  });
});

describe('CG-03 · despesa prevista até o fim do mês', () => {
  const comum = monthFlow(addEntry(data, base({ date: FIM }), TODAY), TODAY);
  const aporte = monthFlow(
    addEntry(data, base({ date: FIM, categoryId: 'investimento' }), TODAY),
    TODAY,
  );

  it('não mexe em Em contas hoje, só no saldo previsto', () => {
    expect(comum.emContasCents).toBe(antes.emContasCents);
    expect(comum.saldoPrevistoCents).toBe(antes.saldoPrevistoCents - 10000);
    expect(comum.despesasPrevistasCents).toBe(antes.despesasPrevistasCents + 10000);
  });

  it('um aporte previsto é parte da despesa prevista, e sai do saldo uma vez só', () => {
    expect(aporte.aportesPrevistosCents).toBe(antes.aportesPrevistosCents + 10000);
    expect(aporte.despesasPrevistasCents).toBe(antes.despesasPrevistasCents + 10000);
    expect(aporte.saldoPrevistoCents).toBe(antes.saldoPrevistoCents - 10000);
  });
});

describe('CG-04 · compra no cartão', () => {
  const depois = monthFlow(addEntry(data, base({ sourceId: cartao.id }), TODAY), TODAY);

  it('aumenta as faturas abertas e não toca em Em contas hoje', () => {
    expect(depois.faturasAbertasCents).toBe(antes.faturasAbertasCents + 10000);
    expect(depois.emContasCents).toBe(antes.emContasCents);
  });
});
