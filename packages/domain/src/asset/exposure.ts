import type { B3Type } from './asset.entities.js';

/**
 * EST-02 · A tabela única do tipo de ativo para a classe de exposição.
 *
 * Estratégia, Alocação da Visão geral e Posições (agrupar por classe) leem esta
 * tabela, e só ela. A classe vem da exposição do ativo, não do tipo: um ETF
 * nunca fica preso a uma categoria. ETF de ações do Brasil conta em Ações
 * Brasil; ETF de renda fixa conta em Renda fixa.
 */
export const EXPOSURE_CLASSES = [
  'acoes_brasil',
  'acoes_exterior',
  'fiis',
  'renda_fixa',
  'outros',
] as const;

export type ExposureClass = (typeof EXPOSURE_CLASSES)[number];

/** O que o ETF expõe: define a classe dele. `null` é "ainda não definido". */
export type EtfExposure = 'acoes_brasil' | 'acoes_exterior' | 'renda_fixa' | 'fiis';

export const EXPOSURE_LABEL: Readonly<Record<ExposureClass, string>> = {
  acoes_brasil: 'Ações Brasil',
  acoes_exterior: 'Ações exterior',
  fiis: 'FIIs',
  renda_fixa: 'Renda fixa',
  outros: 'Outros',
};

/** Tipo → classe. ETF depende da exposição; sem ela, cai em Outros e se vê. */
export const exposureClassOf = (
  type: B3Type | 'fixed_income' | null,
  etfExposure: EtfExposure | null = null,
): ExposureClass => {
  switch (type) {
    case 'stock':
      return 'acoes_brasil';
    case 'bdr':
      return 'acoes_exterior';
    case 'fii':
      return 'fiis';
    case 'treasury':
    case 'fixed_income':
      return 'renda_fixa';
    case 'etf':
      return etfExposure ?? 'outros';
    default:
      return 'outros';
  }
};
