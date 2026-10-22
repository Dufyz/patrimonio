import { MarketDataUnavailableError } from '@patrimonio/application';
import type { AppError, TreasuryProvider, TreasuryQuote } from '@patrimonio/application';
import { addDays } from '@patrimonio/domain';
import type { DateOnly, TreasuryIdentity } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Either } from '@patrimonio/shared';

import type { HttpClient } from '../http/client.js';
import {
  dateField,
  decimalField,
  formatChanged,
  parsing,
} from '../support/format.js';

/**
 * O Tesouro Direto é quem emite o preço do próprio título, então ele é a fonte
 * primária: nenhum intermediário cobre mais nem melhor.
 *
 * A fonte é o CSV do Tesouro Transparente, que tem o histórico completo desde
 * 2002 e é atualizado todo dia útil. O arquivo é grande e o servidor limita
 * requisições por rede, então ele é baixado no máximo uma vez por janela: o
 * conteúdo fica em memória e em disco, e uma recusa deixa uma marca que impede
 * novas tentativas por alguns minutos, inclusive depois de reiniciar o worker.
 *
 * ## Identificação por tipo e vencimento
 *
 * "Tesouro IPCA+ 2029" é nome comercial, e nome comercial muda — já mudou duas
 * vezes. O que não muda é o par (indexador, vencimento), e é por ele que o
 * título é reconhecido. O nome publicado entra numa tabela de tradução, e um
 * produto novo que a tabela não conhece é **ignorado**, não é erro: não há como
 * ter em carteira um papel que o modelo não representa, e derrubar a coleta por
 * causa dele deixaria sem preço os títulos que existem.
 *
 * ## Preço de compra e de venda, separados
 *
 * As duas pontas são guardadas com a taxa do dia. Guardar uma só obrigaria a
 * escolher entre "quanto valeria se eu vendesse hoje" e "quanto custaria
 * comprar mais", e as duas perguntas aparecem na tela.
 */
export const TESOURO_CSV_SOURCE = 'tesouro-transparente';

export const TESOURO_CSV_URL =
  'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv';

type Kind = TreasuryQuote['kind'];

/**
 * O nome publicado traduzido em indexador. A ordem importa: "Tesouro IPCA+ com
 * Juros Semestrais" também contém "Tesouro IPCA+", e as duas linhas levam ao
 * mesmo indexador, então a ambiguidade é inofensiva — mas um prefixo novo que
 * caia em duas regras diferentes deixaria de ser.
 */
const KIND_BY_NAME: readonly (readonly [RegExp, Kind])[] = [
  [/ipca/iu, 'ipca_plus'],
  [/prefixado/iu, 'prefixed'],
  [/selic/iu, 'selic_plus'],
  [/igpm/iu, 'ipca_plus'],
];

export const kindFromName = (name: string): Kind | null => {
  for (const [pattern, kind] of KIND_BY_NAME) {
    if (pattern.test(name)) return kind;
  }

  return null;
};

export const hasSemiannualCoupon = (name: string): boolean =>
  /juros semestrais/iu.test(name);

export type TesouroOptions = { readonly http: HttpClient };

/**
 * As colunas do CSV do Tesouro Transparente. Separador `;`, decimal com vírgula
 * e data em `DD/MM/YYYY` — é um arquivo feito para planilha, não para API.
 */
const CSV_COLUMNS = {
  kind: 'Tipo Titulo',
  maturity: 'Data Vencimento',
  base: 'Data Base',
  buyRate: 'Taxa Compra Manha',
  sellRate: 'Taxa Venda Manha',
  buyPrice: 'PU Compra Manha',
  sellPrice: 'PU Venda Manha',
} as const;

export type CsvOptions = TesouroOptions & {
  /** O arquivo inteiro, quando ele já está em disco em vez de vir por HTTP. */
  readonly body?: string | undefined;
  /** Onde o arquivo baixado e a marca de recusa ficam entre execuções do worker. */
  readonly cacheDir?: string | undefined;
  /** O relógio, em milissegundos; injetado pelos testes. */
  readonly now?: (() => number) | undefined;
};

/** Quanto tempo o arquivo baixado vale. O Tesouro publica uma vez por dia. */
export const CSV_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Depois de uma recusa ou falha, quanto tempo sem tentar de novo. */
export const CSV_BLOCK_MS = 30 * 60 * 1000;

const USER_AGENT = 'patrimonio/0.1 (uso pessoal; leitura diaria do CSV)';

const splitCsv = (line: string): readonly string[] =>
  line.split(';').map((cell) => cell.trim());

type CsvRow = {
  readonly kind: Kind;
  readonly coupon: boolean;
  readonly maturity: DateOnly;
  readonly base: DateOnly;
};

/**
 * Lê o arquivo uma vez e devolve as linhas que `wanted` aceita. A cabeça do
 * arquivo é conferida antes de qualquer linha: coluna que saiu é mudança de
 * formato.
 */
const readCsvQuotes = (
  content: string,
  wanted: (row: CsvRow) => boolean,
): readonly TreasuryQuote[] => {
  const lines = content.split(/\r?\n/u).filter((line) => line.trim() !== '');
  const header = lines[0];

  if (header === undefined) formatChanged('csv', 'veio vazio', content);

  const columns = splitCsv(header ?? '');
  const indexOf = (name: string): number => {
    const index = columns.indexOf(name);

    // Coluna que saiu do arquivo é mudança de formato: ler a posição errada
    // gravaria taxa no lugar de preço, e ninguém notaria.
    if (index < 0) formatChanged(`csv.${name}`, 'não está no cabeçalho', header);

    return index;
  };

  const at_ = {
    kind: indexOf(CSV_COLUMNS.kind),
    maturity: indexOf(CSV_COLUMNS.maturity),
    base: indexOf(CSV_COLUMNS.base),
    buyRate: indexOf(CSV_COLUMNS.buyRate),
    sellRate: indexOf(CSV_COLUMNS.sellRate),
    buyPrice: indexOf(CSV_COLUMNS.buyPrice),
    sellPrice: indexOf(CSV_COLUMNS.sellPrice),
  };

  const quotes: TreasuryQuote[] = [];

  for (const [offset, line] of lines.slice(1).entries()) {
    const cells = splitCsv(line);
    const where = `csv[${offset + 2}]`;

    const base = dateField({ v: cells[at_.base] }, 'v', `${where}.${CSV_COLUMNS.base}`);

    const kindName = cells[at_.kind] ?? '';
    const kind = kindFromName(kindName);
    if (kind === null) continue;

    const maturity = dateField(
      { v: cells[at_.maturity] },
      'v',
      `${where}.${CSV_COLUMNS.maturity}`,
    );

    const coupon = hasSemiannualCoupon(kindName);
    if (!wanted({ kind, coupon, maturity, base })) continue;

    quotes.push({
      kind,
      coupon,
      maturity_date: maturity,
      quote_date: base,
      buy_price: decimalField(
        { v: cells[at_.buyPrice] },
        'v',
        `${where}.${CSV_COLUMNS.buyPrice}`,
      ),
      sell_price: decimalField(
        { v: cells[at_.sellPrice] },
        'v',
        `${where}.${CSV_COLUMNS.sellPrice}`,
      ),
      buy_rate: decimalField(
        { v: cells[at_.buyRate] },
        'v',
        `${where}.${CSV_COLUMNS.buyRate}`,
      ),
      sell_rate: decimalField(
        { v: cells[at_.sellRate] },
        'v',
        `${where}.${CSV_COLUMNS.sellRate}`,
      ),
    });
  }

  return quotes;
};

/**
 * Fim de semana e feriado não têm tabela: o pedido vale o último dia com preço
 * dentro desta janela, e cada título sai com a data em que de fato foi cotado.
 */
const CSV_LOOKBACK_DAYS = 10;

/**
 * O CSV cobre o histórico completo desde 2002, e é a alternativa quando o JSON
 * não responde — e a fonte da carga inicial e do histórico de cada título.
 */
export const createTesouroCsvProvider = (options: CsvOptions): TreasuryProvider => {
  const now = options.now ?? Date.now;
  const file = options.cacheDir === undefined ? null : join(options.cacheDir, 'tesouro.csv');
  const marker =
    options.cacheDir === undefined ? null : join(options.cacheDir, 'tesouro.blocked');

  let memory: { readonly body: string; readonly at: number } | null = null;
  let blocked: { readonly error: AppError; readonly until: number } | null = null;
  let inflight: Promise<Either<AppError, string>> | null = null;

  const blockedError = (until: number): AppError =>
    new MarketDataUnavailableError(
      `${TESOURO_CSV_SOURCE} recusou há pouco; nova tentativa depois de ${new Date(until).toISOString()}`,
    );

  const block = async (error: AppError): Promise<void> => {
    const until = now() + CSV_BLOCK_MS;
    blocked = { error, until };

    if (marker !== null) {
      try {
        await mkdir(options.cacheDir as string, { recursive: true });
        await writeFile(marker, String(until), 'utf8');
      } catch {
        // Sem disco, a marca fica só na memória.
      }
    }
  };

  const download = async (): Promise<Either<AppError, string>> => {
    if (file !== null && marker !== null) {
      try {
        const info = await stat(file);
        if (now() - info.mtimeMs < CSV_CACHE_TTL_MS) {
          return success(await readFile(file, 'utf8'));
        }
      } catch {
        // Sem arquivo guardado: baixa.
      }

      try {
        const until = Number(await readFile(marker, 'utf8'));
        if (Number.isFinite(until) && now() < until) {
          return failure(blockedError(until));
        }
      } catch {
        // Sem marca: segue.
      }
    }

    const response = await options.http({
      url: TESOURO_CSV_URL,
      headers: { 'User-Agent': USER_AGENT },
    });

    if (response.isFailure()) {
      await block(response.value);
      return response;
    }

    if (file !== null) {
      try {
        await mkdir(options.cacheDir as string, { recursive: true });
        await writeFile(file, response.value.body, 'utf8');
      } catch {
        // Sem disco, o conteúdo fica só na memória.
      }
    }

    return success(response.value.body);
  };

  const load = async (): Promise<Either<AppError, string>> => {
    if (options.body !== undefined) return success(options.body);

    if (memory !== null && now() - memory.at < CSV_CACHE_TTL_MS) {
      return success(memory.body);
    }

    if (blocked !== null && now() < blocked.until) return failure(blocked.error);

    // Duas chamadas ao mesmo tempo esperam o mesmo download.
    inflight ??= download().finally(() => {
      inflight = null;
    });

    const loaded = await inflight;
    if (loaded.isSuccess()) memory = { body: loaded.value, at: now() };

    return loaded;
  };

  return {
    id: TESOURO_CSV_SOURCE,

    fetchQuotes: async (
      date: DateOnly,
    ): Promise<Either<AppError, readonly TreasuryQuote[]>> => {
      const content = await load();
      if (content.isFailure()) return content;

      const earliest = addDays(date, -CSV_LOOKBACK_DAYS);

      const read = parsing(TESOURO_CSV_SOURCE, () => {
        const recent = readCsvQuotes(
          content.value,
          (row) => row.base <= date && row.base >= earliest && row.maturity >= date,
        );

        const latest = recent.reduce<DateOnly | null>(
          (best, quote) =>
            best === null || quote.quote_date > best ? quote.quote_date : best,
          null,
        );

        return recent.filter((quote) => quote.quote_date === latest);
      });

      return read.isFailure() ? read : success(read.value);
    },

    fetchHistory: async (
      identity: TreasuryIdentity,
      from: DateOnly,
      to: DateOnly,
    ): Promise<Either<AppError, readonly TreasuryQuote[]>> => {
      const content = await load();
      if (content.isFailure()) return content;

      const read = parsing(TESOURO_CSV_SOURCE, () =>
        readCsvQuotes(
          content.value,
          (row) =>
            row.kind === identity.kind &&
            row.coupon === identity.coupon &&
            row.maturity === identity.maturity_date &&
            row.base >= from &&
            row.base <= to,
        ),
      );

      return read.isFailure() ? read : success(read.value);
    },
  };
};
