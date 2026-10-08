import type { AppError, TreasuryProvider, TreasuryQuote } from '@patrimonio/application';
import type { DateOnly } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import type { HttpClient } from '../http/client.js';
import {
  asArray,
  asJson,
  asObject,
  at,
  dateField,
  decimalField,
  formatChanged,
  parsing,
  stringField,
} from '../support/format.js';

/**
 * O Tesouro Direto é quem emite o preço do próprio título, então ele é a fonte
 * primária: nenhum intermediário cobre mais nem melhor.
 *
 * Duas fontes, a mesma forma de saída. O JSON do site tem o dia corrente; o CSV
 * do Tesouro Transparente tem o histórico completo desde 2002, e é dele que sai
 * a carga inicial. A cadeia põe o JSON na frente e o CSV atrás.
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
export const TESOURO_JSON_SOURCE = 'tesouro-direto';
export const TESOURO_CSV_SOURCE = 'tesouro-transparente';

export const TESOURO_JSON_URL =
  'https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsinfo.json';

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

export type TesouroOptions = { readonly http: HttpClient };

/**
 * O JSON do site. O envelope é profundo e já mudou de nome de campo, então cada
 * degrau é conferido: um `undefined` silencioso aqui gravaria o preço de outro
 * título.
 */
export const createTesouroJsonProvider = (options: TesouroOptions): TreasuryProvider => ({
  id: TESOURO_JSON_SOURCE,

  fetchQuotes: async (
    date: DateOnly,
  ): Promise<Either<AppError, readonly TreasuryQuote[]>> => {
    const response = await options.http({ url: TESOURO_JSON_URL });
    if (response.isFailure()) return response;

    const read = parsing(TESOURO_JSON_SOURCE, () => {
      const body = asObject(asJson(response.value.body, 'body'), 'body');
      const list = asArray(
        at(body, ['response', 'TrsrBdTradgList']),
        'response.TrsrBdTradgList',
      );

      const quotes: TreasuryQuote[] = [];

      for (const [index, item] of list.entries()) {
        const where = `response.TrsrBdTradgList[${index}].TrsrBd`;
        const bond = asObject(at(asObject(item, `${where}`), ['TrsrBd']), where);

        const kind = kindFromName(stringField(bond, 'nm', `${where}.nm`));
        if (kind === null) continue;

        const maturity = dateField(bond, 'mtrtyDt', `${where}.mtrtyDt`);

        // Título vencido para de ser coletado, e isso não é erro: ele saiu da
        // prateleira e o preço dele não existe mais.
        if (maturity < date) continue;

        quotes.push({
          kind,
          maturity_date: maturity,
          quote_date: date,
          buy_price: decimalField(bond, 'untrInvstmtVal', `${where}.untrInvstmtVal`),
          sell_price: decimalField(bond, 'untrRedVal', `${where}.untrRedVal`),
          buy_rate: decimalField(bond, 'anulInvstmtRate', `${where}.anulInvstmtRate`),
          sell_rate: decimalField(bond, 'anulRedRate', `${where}.anulRedRate`),
        });
      }

      return quotes;
    });

    return read.isFailure() ? read : success(read.value);
  },
});

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
};

const splitCsv = (line: string): readonly string[] =>
  line.split(';').map((cell) => cell.trim());

/**
 * O CSV cobre o histórico completo desde 2002, e é a alternativa quando o JSON
 * não responde — e a fonte da carga inicial.
 */
export const createTesouroCsvProvider = (options: CsvOptions): TreasuryProvider => ({
  id: TESOURO_CSV_SOURCE,

  fetchQuotes: async (
    date: DateOnly,
  ): Promise<Either<AppError, readonly TreasuryQuote[]>> => {
    let body = options.body;

    if (body === undefined) {
      const response = await options.http({ url: TESOURO_CSV_URL });
      if (response.isFailure()) return response;
      body = response.value.body;
    }

    const content = body;

    const read = parsing(TESOURO_CSV_SOURCE, () => {
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

        const base = dateField(
          { v: cells[at_.base] },
          'v',
          `${where}.${CSV_COLUMNS.base}`,
        );
        if (base !== date) continue;

        const kind = kindFromName(cells[at_.kind] ?? '');
        if (kind === null) continue;

        const maturity = dateField(
          { v: cells[at_.maturity] },
          'v',
          `${where}.${CSV_COLUMNS.maturity}`,
        );
        if (maturity < date) continue;

        quotes.push({
          kind,
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
    });

    return read.isFailure() ? read : success(read.value);
  },
});
