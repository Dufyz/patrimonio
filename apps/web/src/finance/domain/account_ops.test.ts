import { describe, expect, it } from 'vitest';

import {
  addAccount,
  archiveAccount,
  archiveBlockedReason,
  draftOfAccount,
  emptyAccountDraft,
  restoreAccount,
  updateAccount,
  validateAccount,
} from './account_ops.js';
import { accountBalance, accountsOverview } from './accounts.js';
import { activeSources } from './sources.js';
import {
  transferAccounts,
  validateTransfer,
  emptyTransferDraft,
} from './transfer_ops.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';

const TODAY = SEED_REFERENCE_DATE;
const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
const data = seedData();
const draft = {
  ...emptyAccountDraft(),
  name: 'Inter Conta',
  role: 'Reserva',
  initial: '1.000,00',
};

describe('validateAccount (FIN-404)', () => {
  it('exige nome e saldo inicial', () => {
    expect(Object.keys(validateAccount(data, emptyAccountDraft())).sort()).toEqual([
      'initial',
      'name',
    ]);
  });

  it('o nome é único entre as contas, sem ligar para acento e caixa', () => {
    expect(
      validateAccount(data, { ...draft, name: 'itau corrente' })['name'],
    ).toBeDefined();
    expect(validateAccount(data, { ...draft, name: 'FLEX' })['name']).toBeDefined();
  });

  it('ao editar, o próprio nome não conta como repetido', () => {
    const itau = data.accounts[0]!;
    expect(validateAccount(data, draftOfAccount(itau), itau.id)).toEqual({});
  });
});

describe('addAccount e updateAccount', () => {
  it('conta nova entra no total em contas', () => {
    const next = addAccount(data, draft);
    const overview = accountsOverview(next, OCTOBER, TODAY);
    expect(overview.accounts.map((r) => r.account.name)).toContain('Inter Conta');
    expect(overview.totalBalance).toBe(1258385 + 100000);
    expect(accountBalance(next, 'inter-conta', TODAY)).toBe(100000);
  });

  it('a conta nova vira origem de pagamento', () => {
    const next = addAccount(data, draft);
    expect(activeSources(next).some((s) => s.id === 'inter-conta')).toBe(true);
  });

  it('com erro nada muda; id repetido ganha sufixo', () => {
    expect(addAccount(data, emptyAccountDraft())).toBe(data);
    const once = addAccount(data, draft);
    const twice = addAccount(once, { ...draft, name: 'Inter-Conta' });
    expect(
      validateAccount(once, { ...draft, name: 'Inter-Conta' })['name'],
    ).toBeUndefined();
    expect(new Set(twice.accounts.map((a) => a.id)).size).toBe(twice.accounts.length);
  });

  it('editar o saldo inicial move o saldo atual e mantém a conta fechando', () => {
    const next = updateAccount(data, 'carteira', {
      ...draftOfAccount(data.accounts[2]!),
      initial: '400,00',
    });
    expect(accountBalance(next, 'carteira', TODAY)).toBe(34000);
  });

  it('editar nome e papel; o tipo não muda', () => {
    const itau = data.accounts[0]!;
    const next = updateAccount(data, itau.id, {
      ...draftOfAccount(itau),
      name: 'Itaú Principal',
      role: 'Conta principal',
    });
    const edited = next.accounts[0];
    expect(edited?.name).toBe('Itaú Principal');
    expect(edited?.role).toBe('Conta principal');
    expect(edited?.type).toBe('conta');
    expect(edited?.roleTag).toBeUndefined();
  });
});

describe('arquivar conta (FIN-409, RN-38)', () => {
  it('conta com cartão ativo não pode ser arquivada', () => {
    expect(archiveBlockedReason(data, 'itau-corrente')).toMatch(
      /paga os cartões Itaú Visa/,
    );
    expect(archiveAccount(data, 'itau-corrente', TODAY, true)).toBe(data);
  });

  it('com saldo, só arquiva com confirmação explícita', () => {
    expect(archiveAccount(data, 'carteira', TODAY)).toBe(data);
    const archived = archiveAccount(data, 'carteira', TODAY, true);
    expect(archived.accounts.find((a) => a.id === 'carteira')?.archived).toBe(true);
  });

  it('com saldo zero arquiva direto', () => {
    const withZero = addAccount(data, { ...draft, name: 'Zerada', initial: '0,00' });
    const archived = archiveAccount(withZero, 'zerada', TODAY);
    expect(archived).not.toBe(withZero);
  });

  it('sai do total, das opções de origem e destino, mas o histórico continua', () => {
    const next = archiveAccount(data, 'carteira', TODAY, true);
    expect(accountsOverview(next, OCTOBER, TODAY).totalBalance).toBe(1258385 - 24000);
    expect(activeSources(next).some((s) => s.id === 'carteira')).toBe(false);
    expect(transferAccounts(next).some((a) => a.id === 'carteira')).toBe(false);
    expect(
      validateTransfer(
        next,
        {
          ...emptyTransferDraft(TODAY, 'itau-corrente'),
          toId: 'carteira',
          value: '1,00',
        },
        TODAY,
      )['toId'],
    ).toBeDefined();
    // o extrato e os lançamentos antigos seguem lendo a conta
    expect(accountBalance(next, 'carteira', TODAY)).toBe(24000);
    expect(next.entries).toBe(data.entries);
  });

  it('reativar devolve a conta à lista', () => {
    const archived = archiveAccount(data, 'carteira', TODAY, true);
    const back = restoreAccount(archived, 'carteira');
    expect(back.accounts.find((a) => a.id === 'carteira')?.archived).toBeUndefined();
    expect(restoreAccount(back, 'carteira')).toBe(back);
    expect(accountsOverview(back, OCTOBER, TODAY).totalBalance).toBe(1258385);
  });

  it('benefício arquivado deixa de receber crédito', () => {
    const archived = archiveAccount(data, 'flex', TODAY, true);
    expect(archived.accounts.find((a) => a.id === 'flex')?.archived).toBe(true);
  });
});
