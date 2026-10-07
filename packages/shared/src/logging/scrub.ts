/**
 * O que nunca entra no log: valor monetário, quantidade e nome de ativo. A
 * lista vive aqui, num pacote sem dependência, para a api e o worker não terem
 * duas versões dela.
 *
 * O motivo é concreto: log de um app de patrimônio vai para stdout, é coletado
 * por terceiro e fica 14 dias em disco. Quanto você tem e em quê não precisa
 * passar por lá para o log ser útil — id de carteira e de ativo bastam.
 */
export const FORBIDDEN_LOG_KEYS: readonly string[] = [
  'quantity',
  'unit_price',
  'avg_price',
  'cost_basis',
  'market_value',
  'accrued_interest',
  'net_amount',
  'gross_amount',
  'fees',
  'tax_withheld',
  'price',
  'close',
  'total_value',
  'net_flow',
  'income',
  'payouts',
  'quota_value',
  'quota_count',
  'cumulative_contributions',
  'proceeds',
  'cost_consumed',
  'loss_offset',
  'sales_total',
  'gross_result',
  'loss_carried_forward',
  'target_amount',
  'amount',
  'amount_per_share',
  'balance',
  'ticker',
  'asset_name',
];

const REDACTED = '[redigido]';

const forbidden = new Set(FORBIDDEN_LOG_KEYS);

/**
 * Percorre o registro e troca o valor das chaves proibidas. Mantém a chave:
 * saber que havia um valor ali ajuda a ler o log, e o valor em si não.
 */
export const scrubLogRecord = (record: unknown, depth = 0): unknown => {
  if (depth > 8 || record === null || typeof record !== 'object') return record;

  if (Array.isArray(record)) {
    return record.map((entry) => scrubLogRecord(entry, depth + 1));
  }

  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    output[key] = forbidden.has(key) ? REDACTED : scrubLogRecord(value, depth + 1);
  }

  return output;
};
