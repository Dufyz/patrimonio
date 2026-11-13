import { request } from './client.js';

/**
 * VGR-04 · O saldo previsto e a série diária: `GET /api/finance/forecast`.
 *
 * Uma função na `api` serve a Visão geral e Contas (RN-U16); a tela só desenha.
 */
export type ForecastParts = {
  readonly em_contas: string;
  readonly entradas: string;
  readonly saidas: string;
  readonly aportes: string;
  readonly faturas: string;
  readonly saldo: string;
};

export type ForecastResource = {
  readonly date: string;
  readonly balance: string;
  readonly parts: ForecastParts;
  readonly series: {
    readonly points: readonly {
      readonly date: string;
      readonly balance: string;
      readonly forecast: boolean;
    }[];
    readonly lowest: { readonly date: string; readonly balance: string } | null;
    readonly at_end: string;
  };
};

export const fetchForecast = (
  query: { readonly from: string; readonly to: string },
  signal?: AbortSignal,
): Promise<ForecastResource> =>
  request(
    `/api/finance/forecast?from=${query.from}&to=${query.to}`,
    {
      parse: (value: unknown) => {
        const body = value as Partial<ForecastResource> | null;
        if (body?.parts === undefined || !Array.isArray(body.series?.points)) {
          throw new Error('Resposta de previsão inválida.');
        }
        return body as ForecastResource;
      },
    },
    signal === undefined ? {} : { signal },
  );
