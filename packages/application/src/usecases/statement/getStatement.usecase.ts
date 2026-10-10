import { ledgerEffects } from '@patrimonio/calc';
import type { EntryEffect, LedgerEntry } from '@patrimonio/calc';
import type { DateOnly } from '@patrimonio/domain';
import { either } from '@patrimonio/shared';

import type {
  StatementFilter,
  StatementHistoryRow,
  StatementPair,
  StatementRepository,
} from '../../interfaces/statement.repository.js';
import { statementEffect } from './statementEffect.js';

/**
 * T-04 · O extrato do livro, com o efeito de cada lançamento.
 *
 * O caso de uso faz o que o banco não faz: refaz o preço médio dos ativos que
 * aparecem na página, com o motor, para dizer "PM 38,20 → 36,80" e "−310,00
 * realizado". Somar e filtrar é do repositório; escolher a frase de cada
 * lançamento é de `statementEffect`; o número dentro da frase é do motor.
 *
 * Uma página sem ativo — só aportes, por exemplo — não paga a segunda consulta.
 */
export type GetStatementDeps = { readonly statements: StatementRepository };

const pairKey = (portfolioId: string, assetId: string): string =>
  `${portfolioId}:${assetId}`;

const toEntry = (row: StatementHistoryRow): LedgerEntry => ({
  id: row.id,
  kind: row.kind,
  trade_date: row.trade_date,
  quantity: row.quantity,
  unit_price: row.unit_price,
  fees: row.fees,
  net_amount: row.net_amount,
  payout_kind: row.payout_kind,
  event_ratio_from: row.event_ratio_from,
  event_ratio_to: row.event_ratio_to,
});

/** Aporte e resgate movem caixa, não posição: não há preço médio a refazer. */
const needsReplay = (kind: string): boolean =>
  kind !== 'deposit' && kind !== 'withdrawal';

export const getStatement = (deps: GetStatementDeps) =>
  either(async function* (filter: StatementFilter) {
    const view = yield* await deps.statements.page(filter);

    const pairs = new Map<string, StatementPair>();
    let until: DateOnly | null = null;

    for (const row of view.rows) {
      if (row.asset_id === null || !needsReplay(row.kind)) continue;

      pairs.set(pairKey(row.portfolio_id, row.asset_id), {
        portfolio_id: row.portfolio_id,
        asset_id: row.asset_id,
      });
      if (until === null || row.trade_date > until) until = row.trade_date;
    }

    const effects = new Map<string, EntryEffect>();

    if (until !== null) {
      const history = yield* await deps.statements.history([...pairs.values()], until);

      const byPair = new Map<string, LedgerEntry[]>();
      for (const row of history) {
        const key = pairKey(row.portfolio_id, row.asset_id);
        byPair.set(key, [...(byPair.get(key) ?? []), toEntry(row)]);
      }

      for (const entries of byPair.values()) {
        for (const [id, effect] of ledgerEffects(entries)) effects.set(id, effect);
      }
    }

    return {
      scope: view.scope,
      summary: view.summary,
      facets: view.facets.map((facet) => ({ ...facet })),
      facets_total: view.facets_total,
      institutions: view.institutions.map((institution) => ({ ...institution })),
      months: view.months.map((month) => ({ ...month })),
      page: { number: filter.page, limit: filter.limit, total: view.total },
      rows: view.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        payout_kind: row.payout_kind,
        trade_date: row.trade_date,
        settlement_date: row.settlement_date,
        portfolio_id: row.portfolio_id,
        portfolio_name: row.portfolio_name,
        institution_id: row.institution_id,
        institution_name: row.institution_name,
        asset_id: row.asset_id,
        ticker: row.ticker,
        asset_name: row.asset_name,
        b3_type: row.b3_type,
        quantity: row.quantity,
        unit_price: row.unit_price,
        fees: row.fees,
        gross_amount: row.gross_amount,
        tax_withheld: row.tax_withheld,
        net_amount: row.net_amount,
        confirmed_at: row.confirmed_at,
        note: row.note,
        effect: statementEffect(row, effects.get(row.id)),
      })),
      earlier: view.earlier,
      recalculation: view.recalculation,
    };
  });
