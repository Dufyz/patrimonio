import type { DateOnly } from '@patrimonio/domain';

import { formatChanged } from '../support/format.js';

/**
 * O layout do COTAHIST, o arquivo anual de séries históricas da B3. Oficial,
 * gratuito e completo desde 1986: nenhuma API paga cobre mais, e ele não
 * consome cota de nada.
 *
 * É um arquivo de **largura fixa**, uma linha por papel por dia, 245 caracteres.
 * O preço vem como inteiro de 13 dígitos com duas decimais implícitas: `32.41`
 * aparece como `0000000003241`. Dividir por cem é a leitura certa; interpretar
 * o campo como decimal daria preços cem vezes maiores, e cem vezes maior é o
 * tipo de erro que destrói a confiança no app inteiro.
 *
 * ## O preço é o negociado na data, sem ajuste
 *
 * O arquivo traz o fechamento como foi negociado, sem ajuste por evento
 * corporativo. Isso **não** distorce o patrimônio histórico: `position_daily` de
 * 2015 usa a quantidade que havia em 2015, também anterior ao desdobramento, e
 * preço não ajustado vezes quantidade não ajustada dá o valor correto. O ajuste
 * existe só na exibição do gráfico do ativo.
 *
 * ## As posições que importam
 *
 * | Campo | Posição (1-based) | O que é |
 * | --- | --- | --- |
 * | TIPREG | 1–2 | tipo do registro: `01` é cotação |
 * | DATA | 3–10 | `YYYYMMDD` |
 * | CODBDI | 11–12 | o grupo do papel |
 * | CODNEG | 13–24 | o código de negociação |
 * | TPMERC | 25–27 | `010` é mercado a vista |
 * | PREULT | 109–121 | o fechamento |
 */
export const RECORD_LENGTH = 245;

const FIELDS = {
  tipreg: [0, 2],
  data: [2, 10],
  codbdi: [10, 12],
  codneg: [12, 24],
  tpmerc: [24, 27],
  preult: [108, 121],
} as const;

/** Só o registro de cotação; cabeçalho e rodapé são descartados. */
const QUOTE_RECORD = '01';

/** Mercado a vista. Termo, opção e futuro não são posição de carteira aqui. */
const CASH_MARKET = '010';

const PRICE_DECIMALS = 2;

export type CotahistRecord = {
  readonly ticker: string;
  readonly trade_date: DateOnly;
  readonly close: string;
  /** O grupo do papel, para quem quiser distinguir lote padrão de fracionário. */
  readonly codbdi: string;
};

const slice = (line: string, field: readonly [number, number]): string =>
  line.slice(field[0], field[1]).trim();

/**
 * Um registro, ou `null` quando a linha não é cotação a vista. Linha mais curta
 * do que o layout é mudança de formato: ler posições fora dela devolveria string
 * vazia e, pior, preço zero.
 */
export const parseRecord = (line: string, lineNumber: number): CotahistRecord | null => {
  if (line.trim() === '') return null;

  const kind = slice(line, FIELDS.tipreg);
  if (kind !== QUOTE_RECORD) return null;

  if (line.length < RECORD_LENGTH) {
    formatChanged(
      `cotahist[${lineNumber}]`,
      `tem ${line.length} caracteres, e o layout tem ${RECORD_LENGTH}`,
      line,
    );
  }

  if (slice(line, FIELDS.tpmerc) !== CASH_MARKET) return null;

  const raw = slice(line, FIELDS.data);
  const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    formatChanged(`cotahist[${lineNumber}].DATA`, 'não é uma data', raw);
  }

  const digits = slice(line, FIELDS.preult);

  if (!/^\d+$/u.test(digits)) {
    formatChanged(`cotahist[${lineNumber}].PREULT`, 'não é um inteiro', digits);
  }

  const ticker = slice(line, FIELDS.codneg);
  if (ticker === '') {
    formatChanged(`cotahist[${lineNumber}].CODNEG`, 'veio vazio', line);
  }

  // Duas decimais implícitas: o inteiro é dividido por cem, não reinterpretado.
  const whole = digits.slice(0, Math.max(0, digits.length - PRICE_DECIMALS)) || '0';
  const fraction = digits.slice(-PRICE_DECIMALS).padStart(PRICE_DECIMALS, '0');

  return {
    ticker,
    trade_date: date as DateOnly,
    close: `${String(Number(whole))}.${fraction}`,
    codbdi: slice(line, FIELDS.codbdi),
  };
};
