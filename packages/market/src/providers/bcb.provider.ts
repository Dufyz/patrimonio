import type { AppError, IndexProvider, IndexSample } from '@patrimonio/application';
import type { DateOnly, IndexCode } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import type { HttpClient } from '../http/client.js';
import {
  asArray,
  asJson,
  asObject,
  dateField,
  decimalField,
  parsing,
} from '../support/format.js';

/**
 * O Banco Central é a fonte dos índices, e é fonte primária: gratuita, sem
 * chave, estável há anos. Um intermediário aqui só adicionaria ponto de falha
 * numa série que sustenta toda marcação na curva e todo benchmark.
 *
 * ## As três séries
 *
 * | Série | O que é | Unidade publicada |
 * | --- | --- | --- |
 * | 12 | CDI | taxa **do dia**, em % |
 * | 11 | Selic meta | taxa **do dia**, em % |
 * | 433 | IPCA | variação **do mês**, em % |
 *
 * A série 12 publica a taxa diária já pronta, e o acumulado é o produto de
 * `1 + v/100` — a mesma conta da calculadora do próprio Banco Central, que é
 * por isso que o nosso acumulado de doze meses bate com o dela. Aplicar
 * conversão de prazo aqui, tratando o número como taxa anual, é o erro mais
 * comum nessa integração e dá uma ordem de grandeza de diferença.
 *
 * O provedor não converte nada: devolve o número publicado e diz qual é a
 * unidade. A aritmética é de `calc`.
 */
export const BCB_SOURCE = 'bcb';

/** A série do SGS por código de índice. */
export const SGS_SERIES: Readonly<Record<'CDI' | 'SELIC' | 'IPCA', number>> = {
  CDI: 12,
  SELIC: 11,
  IPCA: 433,
};

const UNIT_OF: Readonly<Record<'CDI' | 'SELIC' | 'IPCA', 'daily_pct' | 'monthly_pct'>> = {
  CDI: 'daily_pct',
  SELIC: 'daily_pct',
  IPCA: 'monthly_pct',
};

type Served = keyof typeof SGS_SERIES;

const SERVED: readonly Served[] = ['CDI', 'SELIC', 'IPCA'];

const isServed = (code: IndexCode): code is Served =>
  (SERVED as readonly string[]).includes(code);

/** O SGS pede e devolve data em `DD/MM/YYYY`. */
const toBrazilian = (date: DateOnly): string => {
  const [year, month, day] = date.split('-');

  return `${day}/${month}/${year}`;
};

export const sgsUrl = (series: number, from: DateOnly, to: DateOnly): string =>
  `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados` +
  `?formato=json&dataInicial=${toBrazilian(from)}&dataFinal=${toBrazilian(to)}`;

export type BcbOptions = {
  readonly http: HttpClient;
};

export const createBcbProvider = (options: BcbOptions): IndexProvider => ({
  id: BCB_SOURCE,
  series: SERVED,

  fetchSeries: async (
    codes: readonly IndexCode[],
    from: DateOnly,
    to: DateOnly,
  ): Promise<Either<AppError, readonly IndexSample[]>> => {
    const samples: IndexSample[] = [];

    // Uma requisição por série, com o intervalo inteiro: dez anos de CDI são
    // uma chamada, não 2.500. É o que torna a carga inicial de graça.
    for (const code of codes) {
      if (!isServed(code)) continue;

      const response = await options.http({ url: sgsUrl(SGS_SERIES[code], from, to) });
      if (response.isFailure()) return response;

      const series = `sgs.${SGS_SERIES[code]}`;

      const read = parsing(BCB_SOURCE, () => {
        const rows = asArray(asJson(response.value.body, `${series}.body`), series);

        return rows.map((row, index): IndexSample => {
          const record = asObject(row, `${series}[${index}]`);
          const where = `${series}[${index}]`;

          return {
            index_code: code,
            reference_date: dateField(record, 'data', `${where}.data`),
            unit: UNIT_OF[code],
            raw_value: decimalField(record, 'valor', `${where}.valor`),
          };
        });
      });

      if (read.isFailure()) return read;

      samples.push(...read.value);
    }

    return success(samples);
  },
});
