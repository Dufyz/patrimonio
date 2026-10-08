import { positionAt } from '@patrimonio/calc';
import type { DateOnly, PayoutKind } from '@patrimonio/domain';
import { either, success } from '@patrimonio/shared';

import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import type { createPayout } from '../transaction/createPayout.usecase.js';

/**
 * O provento anunciado pela fonte vira lançamento "a receber" — e só para quem
 * tinha posição na data-com.
 *
 * ## Três decisões, e o que cada uma evita
 *
 * **A quantidade é a da data-com, não a de hoje.** Quem comprou depois do
 * anúncio não recebe aquele provento, e quem vendeu depois recebe. Usar a
 * posição de hoje erraria nos dois sentidos, e erraria silenciosamente.
 *
 * **Ativo sem posição na data-com não gera lançamento nenhum.** A fonte anuncia
 * o provento do papel, não o seu: um dividendo de um ativo que você não tinha é
 * ruído, e ruído no livro é pior do que ausência.
 *
 * **O lançamento nasce "a receber" quando o pagamento é futuro.** Ele entra
 * confirmado só se a data de pagamento já passou, e a confirmação do usuário
 * converte o que estava a receber sem duplicar — é `confirmPayout`, de E2, que
 * faz isso, e esta função não reimplementa nada dele.
 *
 * ## Idempotência
 *
 * A chave é o par (anúncio, carteira): reprocessar a lista de pendentes não cria
 * o mesmo provento duas vezes, porque `createPayout` reconhece a chave e devolve
 * o lançamento que já existe. Nenhuma fonte gratuita confiável preenche
 * `announced_payout` hoje — o lançamento segue manual, como a documentação de
 * provedores decidiu —, e é por isso que o mecanismo existe pronto e desligado
 * em vez de ausente.
 */
export type MaterializePayoutsInput = {
  readonly reference_date?: DateOnly | undefined;
  readonly origin_request_id?: string | undefined;
};

export type MaterializedPayout = {
  readonly announced_id: string;
  readonly portfolio_id: string;
  readonly transaction_id: string;
  readonly quantity_at_record_date: string;
  readonly confirmed: boolean;
};

export type MaterializePayoutsResult = {
  readonly reference_date: DateOnly;
  readonly created: readonly MaterializedPayout[];
  /** Anúncios sem posição na data-com em carteira nenhuma. */
  readonly skipped: readonly string[];
};

export type MaterializePayoutsDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly createPayout: ReturnType<typeof createPayout>;
};

export const materializeAnnouncedPayouts = (deps: MaterializePayoutsDeps) =>
  either(async function* (input: MaterializePayoutsInput) {
    const date = input.reference_date ?? deps.clock.today();

    const pending = yield* await deps.unitOfWork.run(async (repositories) =>
      repositories.market.pendingAnnouncedPayouts(),
    );

    const created: MaterializedPayout[] = [];
    const skipped: string[] = [];

    for (const announced of pending) {
      // Quem tinha o papel, e em qual instituição. A instituição sai do próprio
      // livro: o provento é creditado onde o ativo está custodiado.
      const holdings = yield* await deps.unitOfWork.run(async (repositories) => {
        const entries = await repositories.ledger.entriesForAsset(announced.asset_id);
        if (entries.isFailure()) return entries;

        const byPortfolio = new Map<
          string,
          { readonly institution_id: string; readonly entries: typeof entries.value }
        >();

        for (const entry of entries.value) {
          const current = byPortfolio.get(entry.portfolio_id);
          byPortfolio.set(entry.portfolio_id, {
            institution_id: entry.institution_id,
            entries: [...(current?.entries ?? []), entry],
          });
        }

        return success(byPortfolio);
      });

      let materializedFor: string | null = null;

      for (const [portfolioId, holding] of holdings) {
        // A posição na data-com decide se há provento e de quanto ele é.
        const quantity = positionAt(holding.entries, announced.record_date).quantity;
        if (Number(quantity) <= 0) continue;

        const paymentDate = announced.payment_date ?? announced.record_date;

        const result = yield* await deps.createPayout({
          portfolio_id: portfolioId,
          institution_id: holding.institution_id,
          asset_id: announced.asset_id,
          payout_kind: announced.payout_kind as PayoutKind,
          record_date: announced.record_date,
          payment_date: paymentDate,
          amount_per_share: announced.amount_per_share,
          // Pagamento no futuro fica a receber; já pago entra confirmado.
          confirmed: paymentDate <= date,
          idempotency_key: `announced:${announced.id}:${portfolioId}`,
          ...(input.origin_request_id === undefined
            ? {}
            : { origin_request_id: input.origin_request_id }),
        });

        created.push({
          announced_id: announced.id,
          portfolio_id: portfolioId,
          transaction_id: result.transaction.id,
          quantity_at_record_date: result.quantity_at_record_date,
          confirmed: result.transaction.confirmed_at !== null,
        });

        materializedFor ??= result.transaction.id;
      }

      if (materializedFor === null) {
        skipped.push(announced.id);
        continue;
      }

      yield* await deps.unitOfWork.run<AppError, boolean>(async (repositories) =>
        repositories.market.markPayoutMaterialized(announced.id, materializedFor),
      );
    }

    const result: MaterializePayoutsResult = {
      reference_date: date,
      created,
      skipped,
    };

    return result;
  });
