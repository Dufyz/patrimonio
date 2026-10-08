import { isFormatChangedError } from '@patrimonio/application';
import type { AppError } from '@patrimonio/application';
import type { DateOnly, IndexCode } from '@patrimonio/domain';

import { createHttpClient, sleep, withRetry } from '../http/client.js';
import type { FetchLike } from '../http/client.js';
import { createBcbProvider } from '../providers/bcb.provider.js';
import { createBrapiProvider } from '../providers/brapi.provider.js';
import {
  createTesouroCsvProvider,
  createTesouroJsonProvider,
} from '../providers/tesouro.provider.js';

/**
 * A bateria de contrato contra as **APIs reais**. É o detector de que a fonte
 * quebrou antes de a tela quebrar.
 *
 * Ela existe porque os testes de commit rodam contra resposta gravada em
 * arquivo, e resposta gravada não muda quando a fonte muda. Um campo que virou
 * `undefined` silencioso não dá erro — dá número errado no patrimônio, e número
 * errado só aparece meses depois.
 *
 * A execução é agendada e independente dos testes de commit: ela fala com a
 * internet, depende de a fonte estar no ar e por isso **não bloqueia commit nem
 * deploy**. O que ela faz é falhar nomeando o campo e guardando o trecho
 * recebido, e o resultado da última execução aparece na tela de dados de
 * mercado.
 *
 * A distinção que importa no resultado: `format_changed` é problema nosso e
 * precisa de alguém; `unavailable` é a fonte fora do ar naquele momento, e isso
 * não é notícia.
 */
export type ProbeOutcome = 'ok' | 'format_changed' | 'unavailable';

export type ProbeResult = {
  readonly source: string;
  readonly outcome: ProbeOutcome;
  readonly items: number;
  readonly message: string | null;
  /** O campo e o trecho recebido, quando o formato mudou. */
  readonly detail: { readonly field: string; readonly received: string } | null;
};

export type ProbeOptions = {
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
  readonly brapiToken?: string | undefined;
  /** Um dia útil recente, do qual as fontes têm dado. */
  readonly reference_date: DateOnly;
  readonly from: DateOnly;
  /** Papéis líquidos, que qualquer fonte conhece. */
  readonly tickers?: readonly string[] | undefined;
};

const classify = (error: AppError): ProbeResult['outcome'] =>
  isFormatChangedError(error) ? 'format_changed' : 'unavailable';

const detailOf = (error: AppError): ProbeResult['detail'] =>
  isFormatChangedError(error) ? { field: error.field, received: error.received } : null;

export const probeSources = async (
  options: ProbeOptions,
): Promise<readonly ProbeResult[]> => {
  const fetchImpl = options.fetch ?? ((url, init) => globalThis.fetch(url, init));

  const clientFor = (source: string, passthrough: readonly number[] = []) =>
    withRetry(
      createHttpClient({
        fetch: fetchImpl,
        timeoutMs: options.timeoutMs ?? 20_000,
        source,
        ...(passthrough.length === 0 ? {} : { passthroughStatuses: passthrough }),
      }),
      { attempts: 2, backoffMs: 1_000, sleep },
    );

  const results: ProbeResult[] = [];

  // ── Banco Central ──────────────────────────────────────────────────────────
  const bcb = createBcbProvider({ http: clientFor('bcb') });
  const series = await bcb.fetchSeries(
    ['CDI', 'SELIC', 'IPCA'] as readonly IndexCode[],
    options.from,
    options.reference_date,
  );

  results.push(
    series.isSuccess()
      ? {
          source: 'bcb',
          outcome: 'ok',
          items: series.value.length,
          message: null,
          detail: null,
        }
      : {
          source: 'bcb',
          outcome: classify(series.value),
          items: 0,
          message: series.value.message,
          detail: detailOf(series.value),
        },
  );

  // ── Tesouro, as duas fontes ────────────────────────────────────────────────
  for (const provider of [
    createTesouroJsonProvider({ http: clientFor('tesouro-direto') }),
    createTesouroCsvProvider({ http: clientFor('tesouro-transparente') }),
  ]) {
    const quotes = await provider.fetchQuotes(options.reference_date);

    results.push(
      quotes.isSuccess()
        ? {
            source: provider.id,
            outcome: 'ok',
            items: quotes.value.length,
            message: null,
            detail: null,
          }
        : {
            source: provider.id,
            outcome: classify(quotes.value),
            items: 0,
            message: quotes.value.message,
            detail: detailOf(quotes.value),
          },
    );
  }

  // ── brapi ──────────────────────────────────────────────────────────────────
  const brapi = createBrapiProvider({
    http: clientFor('brapi', [404]),
    ...(options.brapiToken === undefined ? {} : { token: options.brapiToken }),
    tickersPerRequest: 1,
  });

  const closing = await brapi.fetchClosing(
    options.tickers ?? ['PETR4'],
    options.reference_date,
  );

  results.push(
    closing.isSuccess()
      ? {
          source: 'brapi',
          outcome: 'ok',
          items: closing.value.quotes.length,
          message:
            closing.value.quotes.length === 0
              ? 'a fonte respondeu e não trouxe cotação nenhuma'
              : null,
          detail: null,
        }
      : {
          source: 'brapi',
          outcome: classify(closing.value),
          items: 0,
          message: closing.value.message,
          detail: detailOf(closing.value),
        },
  );

  return results;
};

/** As fontes cujo formato mudou. É o que abre issue e o que falha o job. */
export const formatChanges = (results: readonly ProbeResult[]): readonly ProbeResult[] =>
  results.filter((result) => result.outcome === 'format_changed');

/** Um relatório legível, para o log do job e o corpo da issue. */
export const reportOf = (results: readonly ProbeResult[]): string =>
  results
    .map((result) => {
      const head = `${result.source}: ${result.outcome}`;

      if (result.outcome === 'ok') return `${head} (${result.items} registros)`;

      const where =
        result.detail === null
          ? ''
          : `\n    campo: ${result.detail.field}\n    recebido: ${result.detail.received}`;

      return `${head}\n    ${result.message ?? ''}${where}`;
    })
    .join('\n');
