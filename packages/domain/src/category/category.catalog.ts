/**
 * O catálogo de categorias é da plataforma: a migration `029_seed_categories` o
 * carrega, a pessoa só escolhe e não cria nem edita. São 30 categorias planas,
 * as mesmas do Gorila, e a lista abaixo é a fonte que o banco repete.
 *
 * A cor é um token do design system, e vários papéis dividem o mesmo token:
 * renda fixa bancária usa o pós-fixado, crédito privado usa o de inflação e o
 * que não tem classe própria cai em `class.outros`.
 */
export type CatalogCategory = {
  readonly id: string;
  readonly name: string;
  readonly color_token: string;
  readonly auto_rule: Readonly<Record<string, string>> | null;
  readonly sort_order: number;
};

export const CATEGORY_CATALOG: readonly CatalogCategory[] = [
  { id: '01960000-0002-7000-8000-000000000001', name: 'Ações / Units', color_token: 'class.acoes', auto_rule: { b3_type: 'stock' }, sort_order: 10 },
  { id: '01960000-0002-7000-8000-000000000002', name: 'Ativos Personalizados', color_token: 'class.outros', auto_rule: null, sort_order: 20 },
  { id: '01960000-0002-7000-8000-000000000003', name: 'BDR', color_token: 'class.bdr', auto_rule: { b3_type: 'bdr' }, sort_order: 30 },
  { id: '01960000-0002-7000-8000-000000000004', name: 'Caixa', color_token: 'class.caixa', auto_rule: { b3_type: 'cash' }, sort_order: 40 },
  { id: '01960000-0002-7000-8000-000000000005', name: 'CDB', color_token: 'class.rf-pos', auto_rule: null, sort_order: 50 },
  { id: '01960000-0002-7000-8000-000000000006', name: 'CDCA', color_token: 'class.rf-pos', auto_rule: null, sort_order: 60 },
  { id: '01960000-0002-7000-8000-000000000007', name: 'COE', color_token: 'class.outros', auto_rule: null, sort_order: 70 },
  { id: '01960000-0002-7000-8000-000000000008', name: 'Commodities', color_token: 'class.outros', auto_rule: null, sort_order: 80 },
  { id: '01960000-0002-7000-8000-000000000009', name: 'CRI / CRA', color_token: 'class.rf-inflacao', auto_rule: null, sort_order: 90 },
  { id: '01960000-0002-7000-8000-00000000000a', name: 'Criptomoedas', color_token: 'class.outros', auto_rule: null, sort_order: 100 },
  { id: '01960000-0002-7000-8000-00000000000b', name: 'Debêntures', color_token: 'class.rf-inflacao', auto_rule: null, sort_order: 110 },
  { id: '01960000-0002-7000-8000-00000000000c', name: 'Direitos de Subscrição', color_token: 'class.outros', auto_rule: null, sort_order: 120 },
  { id: '01960000-0002-7000-8000-00000000000d', name: 'DPGE', color_token: 'class.rf-pos', auto_rule: null, sort_order: 130 },
  { id: '01960000-0002-7000-8000-00000000000e', name: 'ETFs', color_token: 'class.etf', auto_rule: { b3_type: 'etf' }, sort_order: 140 },
  { id: '01960000-0002-7000-8000-00000000000f', name: 'Exterior', color_token: 'class.outros', auto_rule: null, sort_order: 150 },
  { id: '01960000-0002-7000-8000-000000000010', name: 'FIIs', color_token: 'class.fiis', auto_rule: { b3_type: 'fii' }, sort_order: 160 },
  { id: '01960000-0002-7000-8000-000000000011', name: 'Fundos', color_token: 'class.outros', auto_rule: null, sort_order: 170 },
  { id: '01960000-0002-7000-8000-000000000012', name: 'Futuros', color_token: 'class.outros', auto_rule: null, sort_order: 180 },
  { id: '01960000-0002-7000-8000-000000000013', name: 'LC', color_token: 'class.rf-pos', auto_rule: null, sort_order: 190 },
  { id: '01960000-0002-7000-8000-000000000014', name: 'LCA / LCI / LCD', color_token: 'class.rf-pos', auto_rule: null, sort_order: 200 },
  { id: '01960000-0002-7000-8000-000000000015', name: 'LF / LFS / LFSN', color_token: 'class.rf-pos', auto_rule: null, sort_order: 210 },
  { id: '01960000-0002-7000-8000-000000000016', name: 'LIG', color_token: 'class.rf-pos', auto_rule: null, sort_order: 220 },
  { id: '01960000-0002-7000-8000-000000000017', name: 'Moedas', color_token: 'class.outros', auto_rule: null, sort_order: 230 },
  { id: '01960000-0002-7000-8000-000000000018', name: 'Opções de Ações', color_token: 'class.outros', auto_rule: null, sort_order: 240 },
  { id: '01960000-0002-7000-8000-000000000019', name: 'Operação Compromissada', color_token: 'class.rf-pos', auto_rule: null, sort_order: 250 },
  { id: '01960000-0002-7000-8000-00000000001a', name: 'Poupança', color_token: 'class.rf-pos', auto_rule: null, sort_order: 260 },
  { id: '01960000-0002-7000-8000-00000000001b', name: 'Recibos de Subscrição', color_token: 'class.outros', auto_rule: null, sort_order: 270 },
  { id: '01960000-0002-7000-8000-00000000001c', name: 'RDB / RDC', color_token: 'class.rf-pos', auto_rule: null, sort_order: 280 },
  { id: '01960000-0002-7000-8000-00000000001d', name: 'Termo de Ações', color_token: 'class.outros', auto_rule: null, sort_order: 290 },
  { id: '01960000-0002-7000-8000-00000000001e', name: 'Tesouro Direto', color_token: 'class.rf-pre', auto_rule: { b3_type: 'treasury' }, sort_order: 300 },
];

const byName = (name: string): string => {
  const found = CATEGORY_CATALOG.find((category) => category.name === name);
  if (found === undefined) throw new Error(`categoria ${name} fora do catálogo`);
  return found.id;
};

export const CATEGORY_IDS = {
  customAssets: byName('Ativos Personalizados'),
  cdb: byName('CDB'),
  lcaLciLcd: byName('LCA / LCI / LCD'),
  criCra: byName('CRI / CRA'),
  debentures: byName('Debêntures'),
} as const;

/** A categoria de um título de renda fixa cadastrado à mão, pelo tipo dele. */
export const fixedIncomeCategoryId = (kind: string): string => {
  switch (kind) {
    case 'cdb':
      return CATEGORY_IDS.cdb;
    case 'lci':
    case 'lca':
      return CATEGORY_IDS.lcaLciLcd;
    case 'cri':
    case 'cra':
      return CATEGORY_IDS.criCra;
    case 'debenture':
      return CATEGORY_IDS.debentures;
    default:
      return CATEGORY_IDS.customAssets;
  }
};
