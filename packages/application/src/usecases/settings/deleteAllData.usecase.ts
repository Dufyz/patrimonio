import { either } from '@patrimonio/shared';

import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

/**
 * "Apagar todos os dados". A frase de confirmação é validada no contrato; aqui
 * fica a atomicidade: o livro todo sai numa transação, ou nada sai. Os dados de
 * mercado ficam — preço de fechamento não é da pessoa e recarregar custa horas.
 */
export type DeleteAllDataDeps = { readonly unitOfWork: UnitOfWork };

export const deleteAllData = (deps: DeleteAllDataDeps) =>
  either(async function* () {
    const counts = yield* await deps.unitOfWork.run((repositories) =>
      repositories.settings.deleteAll(),
    );
    return counts;
  });
