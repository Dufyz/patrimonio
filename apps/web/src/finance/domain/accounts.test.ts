import { describe, expect, it } from 'vitest';

import {
  accountSubtitle,
  dailyBalances,
  statementCloses,
  accountBalance,
  accountLines,
  accountsOverview,
  recentMovements,
  statement,
} from './accounts.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';

const TODAY = SEED_REFERENCE_DATE;
const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
const data = seedData();

describe('saldos de 24/10/2026 (prancha 03)', () => {
  it('fecham com os saldos das pranchas', () => {
    expect(accountBalance(data, 'itau-corrente', TODAY)).toBe(311280);
    expect(accountBalance(data, 'nubank-conta', TODAY)).toBe(842035);
    expect(accountBalance(data, 'carteira', TODAY)).toBe(24000);
    expect(accountBalance(data, 'vale-alimentacao', TODAY)).toBe(61240);
    expect(accountBalance(data, 'flex', TODAY)).toBe(19830);
  });

  it('o total só soma contas; benefícios ficam fora (RN-30)', () => {
    const overview = accountsOverview(data, OCTOBER, TODAY);
    expect(overview.totalBalance).toBe(1177315);
    expect(overview.totalVariation).toBe(157360);
    expect(overview.accounts.map((r) => r.account.name)).toEqual([
      'Itaú Corrente',
      'Nubank Conta',
      'Carteira',
    ]);
    expect(overview.benefits.map((r) => r.account.name)).toEqual([
      'Vale Alimentação',
      'Flex',
    ]);
  });

  it('variação por conta e cartões vinculados', () => {
    const rows = accountsOverview(data, OCTOBER, TODAY).accounts;
    expect(rows.map((r) => r.variation)).toEqual([97925, 65435, -6000]);
    expect(rows.map((r) => r.cards)).toEqual([['Itaú Visa'], ['Nubank Mastercard'], []]);
  });

  it('arquivada some da tabela, a menos que se peça', () => {
    const archived = {
      ...data,
      accounts: data.accounts.map((a) =>
        a.id === 'carteira' ? { ...a, archived: true } : a,
      ),
    };
    expect(accountsOverview(archived, OCTOBER, TODAY).accounts).toHaveLength(2);
    expect(accountsOverview(archived, OCTOBER, TODAY, true).accounts).toHaveLength(3);
    // arquivada exibida continua fora do total (RN-38)
    expect(accountsOverview(archived, OCTOBER, TODAY, true).totalBalance).toBe(
      1177315 - 24000,
    );
    expect(accountsOverview(archived, OCTOBER, TODAY).totalBalance).toBe(1177315 - 24000);
  });
});

describe('extrato do Itaú Corrente (prancha 03B)', () => {
  const stmt = statement(data, 'itau-corrente', OCTOBER, TODAY);

  it('cabeçalho: saldo de 01/10, entrou e saiu', () => {
    expect(stmt.opening).toBe(213355);
    expect(stmt.entered).toBe(1635000);
    expect(stmt.left).toBe(1537075);
    expect(stmt.opening + stmt.entered - stmt.left).toBe(stmt.closing);
    expect(stmt.closing).toBe(311280);
    expect(stmt.lines).toHaveLength(12);
  });

  it('saldo após de cada linha, em ordem cronológica estável', () => {
    const after = stmt.lines.map((l) => [l.date.slice(5), l.description, l.balanceAfter]);
    expect(after).toEqual([
      ['10-05', 'Salário', 1633355],
      ['10-05', 'Plano de saúde', 1572155],
      ['10-05', 'Plano de vida', 1553165],
      ['10-05', 'Transferência para Nubank Conta', 1083165],
      ['10-08', 'Pagamento da fatura Itaú Visa (set)', 932920],
      ['10-10', 'Aluguel e condomínio', 612920],
      ['10-12', 'Freela · Projeto Lume', 792920],
      ['10-15', 'Reembolso da empresa', 827920],
      ['10-15', 'Seguro do carro', 782520],
      ['10-15', 'Internet', 777520],
      ['10-17', 'Conta de luz', 761280],
      ['10-21', 'Investimento', 311280],
    ]);
  });

  it('etiquetas e notas conforme a origem', () => {
    const byName = (name: string) => stmt.lines.find((l) => l.description === name);
    expect(byName('Salário')?.tags).toEqual(['recorrente']);
    expect(byName('Conta de luz')?.tags).toEqual(['recorrente', '2 pagamentos']);
    expect(byName('Conta de luz')?.cents).toBe(-16240);
    expect(byName('Conta de luz')?.note).toBe(
      'parte da conta · R$ 150,00 saíram do Flex',
    );
    expect(byName('Transferência para Nubank Conta')?.tags).toEqual(['transferência']);
    expect(byName('Transferência para Nubank Conta')?.note).toBe('saldo livre do mês');
    expect(byName('Pagamento da fatura Itaú Visa (set)')?.tags).toEqual(['fatura']);
    expect(byName('Freela · Projeto Lume')?.tags).toEqual(['recorrente']);
  });

  it('compra no cartão e previsto não aparecem', () => {
    const names = stmt.lines.map((l) => l.description);
    expect(names).not.toContain('Netflix');
    expect(names).not.toContain('Spotify');
    expect(names).not.toContain('Investimento · previsto');
  });

  it('período que termina antes de hoje fecha no último dia dele', () => {
    const early = statement(
      data,
      'itau-corrente',
      { from: '2026-10-01', to: '2026-10-09' },
      TODAY,
    );
    expect(early.closing).toBe(932920);
    expect(early.through).toBe('2026-10-09');
    const nextMonth = statement(
      data,
      'itau-corrente',
      { from: '2026-11-01', to: '2026-11-30' },
      TODAY,
    );
    expect(nextMonth.lines).toHaveLength(0);
    expect(nextMonth.opening).toBe(nextMonth.closing);
  });

  it('o saldo cresce no dia 05 e cai no 21 (gráfico)', () => {
    const lines = accountLines(data, 'itau-corrente', TODAY);
    expect(lines[0]?.balanceAfter).toBe(1633355);
    expect(lines.at(-1)?.balanceAfter).toBe(311280);
  });
});

describe('Nubank Conta e Flex', () => {
  it('recebe a transferência e paga a fatura', () => {
    const lines = accountLines(data, 'nubank-conta', TODAY);
    expect(lines.map((l) => l.tags[0])).toEqual(['transferência', 'fatura']);
    expect(lines.map((l) => l.balanceAfter)).toEqual([1246600, 842035]);
  });

  it('o Flex mostra a parte que pagou', () => {
    const lines = accountLines(data, 'flex', TODAY);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.cents).toBe(-15000);
    expect(lines[0]?.note).toBe('parte da conta · R$ 162,40 saíram do Itaú Corrente');
  });
});

describe('últimas movimentações (FIN-402)', () => {
  const recent = recentMovements(data, TODAY);

  it('oito, da mais nova para a mais antiga', () => {
    expect(recent).toHaveLength(8);
    const dates = recent.map((m) => m.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(recent[0]?.description).toBe('Investimento');
  });

  it('despesa com duas origens aparece uma vez, com o total', () => {
    const luz = recent.filter((m) => m.description === 'Conta de luz');
    expect(luz).toHaveLength(1);
    expect(luz[0]?.cents).toBe(-31240);
    expect(luz[0]?.accountLabel).toBe('Flex + Itaú Corrente');
    expect(luz[0]?.tags).toEqual(['recorrente', '2 pagamentos']);
  });

  it('transferência aparece uma vez e fatura é movimentação', () => {
    const all = recentMovements(data, TODAY, 50);
    expect(all.filter((m) => m.tags.includes('transferência'))).toHaveLength(1);
    expect(all.filter((m) => m.tags.includes('fatura'))).toHaveLength(2);
    expect(all.some((m) => m.description === 'Netflix')).toBe(false);
  });
});

describe('consistência do extrato (FIN-405)', () => {
  it('saldo inicial + entradas − saídas fecha com o saldo atual em toda conta e período', () => {
    for (const account of data.accounts) {
      for (const range of [
        OCTOBER,
        { from: '2026-10-10', to: '2026-10-20' },
        { from: '2025-11-01', to: '2026-10-31' },
      ]) {
        const stmt = statement(data, account.id, range, TODAY);
        expect(statementCloses(stmt)).toBe(true);
      }
    }
  });

  it('detecta um extrato que não fecha', () => {
    const stmt = statement(data, 'itau-corrente', OCTOBER, TODAY);
    expect(statementCloses({ ...stmt, closing: stmt.closing + 1 })).toBe(false);
  });

  it('o saldo de fechamento é o saldo da conta', () => {
    for (const account of data.accounts) {
      expect(statement(data, account.id, OCTOBER, TODAY).closing).toBe(
        accountBalance(data, account.id, TODAY),
      );
    }
  });

  it('subtítulo: tipo, instituição e cartões', () => {
    const by = (id: string) => data.accounts.find((a) => a.id === id)!;
    expect(accountSubtitle(by('itau-corrente'))).toBe(
      'Conta corrente · Itaú Unibanco · cartão Itaú Visa',
    );
    expect(accountSubtitle(by('carteira'))).toBe('Conta');
    expect(accountSubtitle(by('flex'))).toBe('Benefício');
  });
});

describe('saldo dia a dia (FIN-406)', () => {
  const days = dailyBalances(data, 'itau-corrente', OCTOBER, TODAY);

  it('um ponto por dia, do dia 1 até hoje', () => {
    expect(days).toHaveLength(24);
    expect(days[0]).toEqual({ date: '2026-10-01', cents: 213355 });
    expect(days.at(-1)).toEqual({ date: '2026-10-24', cents: 311280 });
  });

  it('o saldo do dia é o saldo após a última movimentação do dia', () => {
    const at = (day: string) => days.find((d) => d.date === `2026-10-${day}`)?.cents;
    expect(at('05')).toBe(1083165);
    expect(at('06')).toBe(1083165);
    expect(at('15')).toBe(777520);
    expect(at('21')).toBe(311280);
  });

  it('o período que vai além de hoje termina em hoje', () => {
    const wide = dailyBalances(
      data,
      'itau-corrente',
      { from: '2026-10-20', to: '2026-12-31' },
      TODAY,
    );
    expect(wide.at(-1)?.date).toBe('2026-10-24');
    expect(wide[0]?.cents).toBe(761280);
  });

  it('período futuro não tem pontos', () => {
    expect(
      dailyBalances(
        data,
        'itau-corrente',
        { from: '2026-11-01', to: '2026-11-30' },
        TODAY,
      ),
    ).toEqual([]);
  });
});
