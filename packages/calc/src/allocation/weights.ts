import { Decimal } from 'decimal.js';

import { applyLedger } from '../average_price/ledger.js';
import type { LedgerEntry } from '../average_price/ledger.js';

/**
 * O peso de cada posição na carteira. Enquanto a projeção diária não existe, a
 * base é o custo — e quem chama diz isso na resposta, em vez de apresentar o
 * número como se fosse valor de mercado.
 *
 * A soma não é feita em SQL de propósito: desdobramento muda quantidade por
 * razão, e uma soma de quantidades daria a resposta errada exatamente nos
 * ativos que mais importam.
 */
export type AssetLedgerEntry = LedgerEntry & { readonly asset_id: string | null };

export const costBasisByAsset = (
  entries: readonly AssetLedgerEntry[],
): Map<string, string> => {
  const grouped = new Map<string, AssetLedgerEntry[]>();

  for (const entry of entries) {
    if (entry.asset_id === null) continue;
    const bucket = grouped.get(entry.asset_id) ?? [];
    bucket.push(entry);
    grouped.set(entry.asset_id, bucket);
  }

  const result = new Map<string, string>();

  for (const [assetId, bucket] of grouped) {
    result.set(assetId, applyLedger(bucket).position.cost_basis);
  }

  return result;
};

export const sumValues = (values: Iterable<string>): string => {
  let total = new Decimal(0);
  for (const value of values) total = total.plus(new Decimal(value));
  return total.toDecimalPlaces(2).toFixed(2);
};

/** Percentual com duas casas. Carteira vazia devolve zero, nunca `NaN`. */
export const weightPct = (value: string, total: string): string => {
  const base = new Decimal(total);
  if (base.isZero()) return '0.00';

  return new Decimal(value).dividedBy(base).times(100).toDecimalPlaces(2).toFixed(2);
};

/** Desvio em pontos percentuais, com sinal: positivo é acima do alvo. */
export const deviationPp = (current: string, target: string): string =>
  new Decimal(current).minus(new Decimal(target)).toDecimalPlaces(2).toFixed(2);
