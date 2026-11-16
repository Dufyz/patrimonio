import { loadFinanceDemo } from '@patrimonio/db';

import { createApiHarness, resetSourceTables } from './harness.js';
import { seedUnifiedInvestments } from './unified_investments.js';

/**
 * QUA-08 · A api com o fixture unificado de 11/11/2026 (Finanças e carteiras da
 * §2.3), para a regressão visual capturar as telas reais. Só roda por
 * `pnpm visual`; nunca no teste.
 */
const harness = await createApiHarness({
  clock: {
    now: () => new Date('2026-11-11T15:00:00.000Z'),
    today: () => '2026-11-11' as never,
  },
});
await resetSourceTables(harness.sql);
await loadFinanceDemo(harness.sql, 'unified_fixture');
await seedUnifiedInvestments(harness.sql);
const port = Number(process.env['VISUAL_API_PORT'] ?? 3333);
harness.app.listen(port, () => {
  console.log(`visual-api:${port}`);
});
