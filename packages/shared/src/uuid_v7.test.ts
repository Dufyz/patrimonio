import { describe, expect, it } from 'vitest';

import { uuidV7 } from './uuid_v7.js';

describe('uuidV7', () => {
  it('tem versão 7, variante RFC e cresce com o tempo', () => {
    const early = uuidV7(() => new Date('2026-01-01T00:00:00Z'));
    const late = uuidV7(() => new Date('2026-06-01T00:00:00Z'));
    expect(early).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(early < late).toBe(true);
  });
});
