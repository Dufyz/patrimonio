import { describe, expect, it } from 'vitest';

import { checkRestorable, confirmed, parseBackupName } from './restore.js';

describe('BKP-03 · restaurar', () => {
  it('lê data, esquema e manual do nome', () => {
    expect(parseBackupName('patrimonio-2026-11-12-s039.dump.age')).toEqual({
      date: '2026-11-12',
      schema: '039',
      manual: false,
    });
    expect(
      parseBackupName('patrimonio-2026-11-12-manual-1530-s039.dump.age')?.manual,
    ).toBe(true);
    expect(parseBackupName('qualquer.txt')).toBeNull();
  });

  it('recusa esquema mais novo que o do app, com mensagem', () => {
    const result = checkRestorable('patrimonio-2026-11-12-s041.dump.age', '039');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/mais novo/);
    expect(checkRestorable('patrimonio-2026-11-12-s039.dump.age', '039').ok).toBe(true);
    expect(checkRestorable('patrimonio-2026-11-12-s030.dump.age', '039').ok).toBe(true);
  });

  it('sem versão de esquema no nome não dá para conferir', () => {
    expect(checkRestorable('patrimonio-2026-11-12.dump.age', '039').ok).toBe(false);
  });

  it('a confirmação é exatamente RESTAURAR', () => {
    expect(confirmed('RESTAURAR')).toBe(true);
    expect(confirmed('restaurar')).toBe(false);
    expect(confirmed(undefined)).toBe(false);
  });
});
