import type { DateOnly, InstrumentType } from '@patrimonio/domain';
import { either, success } from '@patrimonio/shared';

import type { Clock } from '../../interfaces/clock.js';
import type { InstrumentLookup } from '../../interfaces/market_data.js';
import type {
  SearchAssetRow,
  SearchFilter,
  SearchRepository,
} from '../../interfaces/search.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

/**
 * T-09 · A busca global.
 *
 * O caso de uso faz o que o banco não faz: decide que busca em branco não vai
 * ao banco, monta a posição como um objeto só, ou como ausência, e decide se o
 * catálogo local bastou. Achar e ordenar é do repositório; o que significa cada
 * resultado é da paleta.
 *
 * Texto vazio devolve a resposta vazia sem pagar consulta. A paleta sem texto
 * mostra recentes, telas e ações — nada disso mora aqui —, e o pedido só sai
 * quando há o que procurar.
 *
 * ## Papéis que a pessoa não tem
 *
 * A resposta traz três grupos de papel: os **ativos** da carteira, os papéis do
 * **catálogo** que ainda não são ativo, e — só quando nem um nem outro achou
 * nada — os papéis que a **fonte ao vivo** conhece. O ao vivo é o último recurso
 * por gastar cota: ele só roda com três letras ou mais, sem nenhum resultado
 * local, e com cota sobrando no mês. Cada chamada vira uma execução registrada
 * (`kind = lookup`), que é como a cota a conta.
 *
 * `fallback` diz o que aconteceu: `none` quando não foi preciso, `used` quando a
 * fonte respondeu, `unavailable` quando ela não respondeu ou não havia cota. A
 * busca nunca falha por causa dela — o catálogo local é a resposta, e a fonte
 * ao vivo só acrescenta.
 */
export type SearchLookup = {
  readonly source: InstrumentLookup;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
};

export type SearchGlobalDeps = {
  readonly search: SearchRepository;
  readonly lookup?: SearchLookup | undefined;
};

/** Menos letras que isto não vale uma requisição da cota. */
export const LOOKUP_MIN_LENGTH = 3;

export type InstrumentSource = 'catalog' | 'brapi';

export type SearchFallback = 'none' | 'used' | 'unavailable';

const holdingOf = (row: SearchAssetRow) =>
  row.quantity === null || row.market_value === null
    ? null
    : {
        quantity: row.quantity,
        market_value: row.market_value,
        portfolio_names: [...row.portfolio_names],
      };

const monthStart = (today: DateOnly): string => `${today.slice(0, 7)}-01T00:00:00.000Z`;

const EMPTY = {
  query: '',
  assets: { total: 0, items: [] },
  instruments: {
    total: 0,
    items: [],
    fallback: 'none' as SearchFallback,
    catalog_empty: false,
  },
  transactions: { total: 0, items: [] },
};

export const searchGlobal = (deps: SearchGlobalDeps) =>
  either(async function* (filter: SearchFilter) {
    const text = filter.text.trim();

    if (text === '') return EMPTY;

    const view = yield* await deps.search.find({ ...filter, text });

    const instruments: {
      ticker: string;
      name: string;
      b3_type: InstrumentType;
      maturity_date: DateOnly | null;
      source: InstrumentSource;
    }[] = view.instruments.rows.map((row) => ({
      ticker: row.ticker,
      name: row.name,
      b3_type: row.b3_type,
      maturity_date: row.maturity_date,
      source: 'catalog',
    }));
    let instrumentsTotal = view.instruments.total;
    let fallback: SearchFallback = 'none';

    const lookup = deps.lookup;
    const nothingLocal = view.assets.total === 0 && view.instruments.total === 0;

    if (lookup !== undefined && nothingLocal && text.length >= LOOKUP_MIN_LENGTH) {
      const today = lookup.clock.today();
      const startedAt = lookup.clock.now().toISOString();

      const used = yield* await lookup.unitOfWork.run(async (repositories) => {
        const statuses = await repositories.market.sourceStatuses({
          requests_since: monthStart(today),
        });
        if (statuses.isFailure()) return statuses;

        return success(
          statuses.value
            .filter((status) => status.source === lookup.source.id)
            .reduce((sum, status) => sum + status.requests_in_window, 0),
        );
      });

      if (used >= lookup.source.monthlyCeiling) {
        fallback = 'unavailable';
      } else {
        const found = await lookup.source.search(text, filter.limit);

        yield* await lookup.unitOfWork.run(async (repositories) =>
          repositories.market.recordRun({
            source: lookup.source.id,
            kind: 'lookup',
            reference_date: today,
            started_at: startedAt,
            finished_at: lookup.clock.now().toISOString(),
            ok: found.isSuccess(),
            requests: 1,
            items: found.isSuccess() ? found.value.length : 0,
            missing: 0,
            error: found.isFailure() ? found.value.message : null,
            detail: null,
          }),
        );

        if (found.isSuccess()) {
          fallback = 'used';
          instrumentsTotal = found.value.length;
          instruments.push(
            ...found.value.map((item) => ({
              ticker: item.ticker,
              name: item.name,
              b3_type: item.b3_type,
              maturity_date: null,
              source: 'brapi' as const,
            })),
          );
        } else {
          fallback = 'unavailable';
        }
      }
    }

    return {
      query: text,
      assets: {
        total: view.assets.total,
        items: view.assets.rows.map((row) => ({
          id: row.id,
          ticker: row.ticker,
          name: row.name,
          b3_type: row.b3_type,
          holding: holdingOf(row),
        })),
      },
      instruments: {
        total: instrumentsTotal,
        items: instruments,
        fallback,
        catalog_empty: view.instruments.catalog_empty,
      },
      transactions: {
        total: view.transactions.total,
        items: view.transactions.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          payout_kind: row.payout_kind,
          trade_date: row.trade_date,
          portfolio_id: row.portfolio_id,
          portfolio_name: row.portfolio_name,
          asset_id: row.asset_id,
          ticker: row.ticker,
          asset_name: row.asset_name,
          b3_type: row.b3_type,
          quantity: row.quantity,
          net_amount: row.net_amount,
          pending: row.kind === 'payout' && row.confirmed_at === null,
        })),
      },
    };
  });
