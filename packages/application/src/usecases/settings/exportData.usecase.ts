import { either } from '@patrimonio/shared';

import type { SettingsRepository } from '../../interfaces/settings.repository.js';

/**
 * "Exportar tudo". O arquivo é o que a pessoa digitou — cadastros e livro —, e
 * não o que o sistema derivou: posições, patrimônio diário e resultado realizado
 * se recalculam a partir dele. O texto vem pronto do banco, sem `number`.
 */
export type ExportDataDeps = { readonly settings: SettingsRepository };

export const exportData = (deps: ExportDataDeps) =>
  either(async function* () {
    const json = yield* await deps.settings.exportAll();
    return { json };
  });
