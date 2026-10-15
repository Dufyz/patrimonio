import {
  caixinhaRedemptionPlanSchema,
  caixinhaResponseSchema,
} from '@patrimonio/contracts';
import type { CaixinhaRedemptionPlan, GetCaixinhaResponse } from '@patrimonio/contracts';

import { request } from './client.js';
import type { Parser } from './client.js';

/**
 * A caixinha: um ativo cujos aportes são lotes. A tela lê os lotes e o plano de
 * resgate prontos — qual lote é consumido e quanto de IR cai em cada um é conta
 * da `api`, e nenhum número é refeito aqui.
 */
const base = (portfolioId: string, assetId: string): string =>
  `/api/portfolios/${portfolioId}/assets/${assetId}/caixinha`;

export const fetchCaixinha = (
  portfolioId: string,
  assetId: string,
  signal?: AbortSignal,
): Promise<GetCaixinhaResponse> =>
  request(
    base(portfolioId, assetId),
    caixinhaResponseSchema,
    signal === undefined ? {} : { signal },
  );

export type RedemptionBody = {
  readonly trade_date: string;
  readonly amount: string;
};

export const previewCaixinhaRedemption = (
  portfolioId: string,
  assetId: string,
  body: RedemptionBody,
  signal?: AbortSignal,
): Promise<CaixinhaRedemptionPlan> =>
  request(
    `${base(portfolioId, assetId)}/redemptions/preview`,
    caixinhaRedemptionPlanSchema,
    {
      method: 'POST',
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    },
  );

const acknowledged: Parser<unknown> = { parse: (value) => value };

export const redeemCaixinha = async (
  portfolioId: string,
  assetId: string,
  body: RedemptionBody,
  attemptKey: string,
): Promise<void> => {
  await request(`${base(portfolioId, assetId)}/redemptions`, acknowledged, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Idempotency-Key': attemptKey },
  });
};
