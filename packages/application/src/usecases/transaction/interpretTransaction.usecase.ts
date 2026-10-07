import type { Asset } from '@patrimonio/domain';
import { either } from '@patrimonio/shared';

import type { AssetRepository } from '../../interfaces/asset.repository.js';
import type { Clock } from '../../interfaces/clock.js';
import { interpretTransactionText } from './interpretText.js';
import type { TextInterpretation } from './interpretText.js';

export type InterpretTransactionDeps = {
  readonly assets: AssetRepository;
  readonly clock: Clock;
};

export type InterpretTransactionResult = TextInterpretation & {
  /** O ativo que o código encontrou, quando ele já existe no cadastro. */
  readonly asset: Asset | null;
  /** Quando o código não casa com nada, o que mais se parece com ele. */
  readonly candidates: readonly Asset[];
};

/**
 * A interpretação do texto, com o ativo resolvido contra o cadastro. Texto
 * ambíguo não salva: a resposta diz o que falta, e a tela pede a
 * desambiguação antes de qualquer gravação.
 */
export const interpretTransaction = (deps: InterpretTransactionDeps) =>
  either(async function* (text: string) {
    const interpretation = interpretTransactionText(text, { today: deps.clock.today() });

    if (interpretation.ticker === null) {
      const result: InterpretTransactionResult = {
        ...interpretation,
        asset: null,
        candidates: [],
      };
      return result;
    }

    const exact = yield* await deps.assets.findByTicker(interpretation.ticker);

    if (exact !== null) {
      const result: InterpretTransactionResult = {
        ...interpretation,
        asset: exact,
        candidates: [],
      };
      return result;
    }

    // Sem casamento exato, a busca devolve o que se parece: um ticker digitado
    // pela metade é mais comum do que um ativo que não existe.
    const candidates = yield* await deps.assets.list({
      search: interpretation.ticker,
      includeArchived: false,
    });

    const result: InterpretTransactionResult = {
      ...interpretation,
      asset: null,
      candidates,
    };

    return result;
  });
