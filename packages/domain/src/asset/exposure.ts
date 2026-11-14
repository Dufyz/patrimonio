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
export const ETF_EXPOSURES = [
  'acoes_brasil',
  'acoes_exterior',
  'renda_fixa',
  'fiis',
] as const;
export type EtfExposure = (typeof ETF_EXPOSURES)[number];

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

/**
 * A classe de cada exposição de ETF é uma categoria do catálogo (filha do grupo
 * da classe). Estratégia, Alocação da Visão geral e Posições agrupam pelo grupo
 * da categoria; ligar a exposição à categoria é o que faz as três concordarem.
 */
export const ETF_EXPOSURE_CATEGORY_ID: Readonly<Record<EtfExposure, string>> = {
  acoes_brasil: '01960000-0002-7000-8000-000000000030',
  fiis: '01960000-0002-7000-8000-000000000031',
  renda_fixa: '01960000-0002-7000-8000-000000000032',
  acoes_exterior: '01960000-0002-7000-8000-000000000033',
};
