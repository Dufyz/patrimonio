import type {
  Settings,
  SettingsBackup,
  SettingsCategory,
  SettingsInstitution,
} from '@patrimonio/contracts';
import { describe, expect, it } from 'vitest';

import {
  ALERT_COPY,
  alertCopy,
  alertLimit,
  autoRuleText,
  backupSummary,
  categoryHold,
  fgcNote,
  formatInstant,
  groupCategories,
  isEmptyInstallation,
  missingPricesText,
  portfolioHold,
  sectionFromParam,
  sortAlerts,
} from './settings.js';

const category = (overrides: Partial<SettingsCategory>): SettingsCategory => ({
  id: 'c',
  parent_id: null,
  name: 'Categoria',
  color_token: 'class.rf',
  auto_rule: null,
  sort_order: 0,
  assets: 0,
  strategies: 0,
  children: 0,
  ...overrides,
});

const institution = (overrides: Partial<SettingsInstitution>): SettingsInstitution => ({
  id: 'i',
  name: 'Banco',
  role: 'both',
  fgc_covered: true,
  brokerage_per_order: '0.00',
  custody_monthly_fee: '0.00',
  portfolios: [],
  cash: null,
  fgc: null,
  blocking: { transactions: 0, assets: 0 },
  ...overrides,
});

const backup = (overrides: Partial<SettingsBackup>): SettingsBackup => ({
  enabled: true,
  last_success_at: null,
  last_failure: null,
  pending: false,
  ...overrides,
});

describe('a seção pedida pela URL', () => {
  it('uma seção conhecida abre ela; qualquer outra abre a primeira', () => {
    expect(sectionFromParam('backup')).toBe('backup');
    expect(sectionFromParam('inexistente')).toBe('carteiras');
    expect(sectionFromParam(null)).toBe('carteiras');
  });
});

describe('o que prende a exclusão', () => {
  it('escreve a contagem, e nada quando nada prende', () => {
    expect(portfolioHold({ transactions: 41, assets: 9 })).toBe(
      '41 lançamentos · 9 ativos',
    );
    expect(portfolioHold({ transactions: 1, assets: 1 })).toBe('1 lançamento · 1 ativo');
    expect(portfolioHold({ transactions: 0, assets: 0 })).toBeNull();
  });

  it('a categoria soma o que a prende: filhas, ativos e estratégias', () => {
    expect(categoryHold(category({ children: 3, assets: 16, strategies: 4 }))).toBe(
      '3 categorias dentro · 16 ativos · 4 estratégias',
    );
    expect(categoryHold(category({ assets: 1 }))).toBe('1 ativo');
    expect(categoryHold(category({}))).toBeNull();
  });
});

describe('os alertas', () => {
  it('toda regra do vocabulário tem rótulo e descrição', () => {
    for (const [kind, copy] of Object.entries(ALERT_COPY)) {
      expect(copy.label, kind).not.toBe('');
      expect(copy.description, kind).not.toBe('');
    }
  });

  it('uma regra que a tela não conhece aparece pelo nome, e não some', () => {
    expect(alertCopy('regra_nova').label).toBe('regra_nova');
  });

  it('o limite é escrito como a prancha o escreve', () => {
    expect(alertLimit({ scope: 'global', threshold: { days: 3 } })).toBe('3 dias');
    expect(alertLimit({ scope: 'global', threshold: { days: 1 } })).toBe('1 dia');
    expect(alertLimit({ scope: 'global', threshold: { pct: '10' } })).toBe('10%');
    expect(alertLimit({ scope: 'global', threshold: { pct: 7.5, days: 30 } })).toBe(
      '7,5% · 30 dias',
    );
    expect(alertLimit({ scope: 'global', threshold: null })).toBe('—');
    expect(alertLimit({ scope: 'global', threshold: { desconhecido: 1 } })).toBe('—');
    expect(alertLimit({ scope: 'per_portfolio', threshold: null })).toBe('da carteira');
  });

  it('a ordem é a da prancha, e as regras desconhecidas vão para o fim', () => {
    const rule = (kind: string) => ({
      kind,
      enabled: true,
      scope: 'global' as const,
      threshold: null,
    });

    expect(
      sortAlerts([rule('zzz'), rule('corporate_event_pending'), rule('price_stale')]).map(
        (item) => item.kind,
      ),
    ).toEqual(['price_stale', 'corporate_event_pending', 'zzz']);
  });
});

describe('as categorias', () => {
  it('a regra automática vira frase, e regra ausente vira traço', () => {
    expect(autoRuleText({ b3_type: 'stock' })).toBe('Tipo B3: ação ou unit');
    expect(autoRuleText({ b3_type: 'fii' })).toBe('Tipo B3: fundo imobiliário');
    expect(autoRuleText({ indexer: 'ipca_plus' })).toBe('Indexador IPCA');
    expect(autoRuleText({ indexer: 'cdi_pct' })).toBe('Indexador CDI ou Selic');
    expect(autoRuleText({ origin: 'manual', sector: 'Bancos' })).toBe(
      'Cadastrado à mão · Setor: Bancos',
    );
    expect(autoRuleText(null)).toBe('—');
    expect(autoRuleText({ chave_estranha: 1 })).toBe('—');
  });

  it('agrupa por grupo de topo, na ordem do cadastro, com as de dentro por baixo', () => {
    const groups = groupCategories([
      category({ id: 'rv', name: 'Renda variável', sort_order: 4 }),
      category({ id: 'pre', parent_id: 'rf', name: 'Prefixada', sort_order: 4 }),
      category({ id: 'rf', name: 'Renda fixa', sort_order: 1 }),
      category({ id: 'pos', parent_id: 'rf', name: 'Pós-fixada', sort_order: 2 }),
    ]);

    expect(groups.map((entry) => entry.group.name)).toEqual([
      'Renda fixa',
      'Renda variável',
    ]);
    expect(groups[0]?.children.map((child) => child.name)).toEqual([
      'Pós-fixada',
      'Prefixada',
    ]);
    expect(groups[1]?.children).toEqual([]);
  });
});

describe('as instituições', () => {
  it('sem barra de FGC a coluna diz por quê', () => {
    expect(fgcNote(institution({ role: 'custodian', fgc_covered: false }))).toBe(
      'não se aplica',
    );
    expect(fgcNote(institution({ role: 'issuer', fgc_covered: false }))).toBe(
      'sem cobertura do FGC',
    );
    expect(fgcNote(institution({ role: 'both', fgc_covered: true }))).toBe('—');
  });
});

describe('os dados de mercado', () => {
  it('o instante sai no fuso de quem usa, e a ausência é traço', () => {
    expect(formatInstant('2026-10-06T18:02:00Z')).toBe('06/10 15:02');
    expect(formatInstant('2026-10-07T02:30:00Z')).toBe('06/10 23:30');
    expect(formatInstant('2026-10-06T18:02:00Z', 'UTC')).toBe('06/10 18:02');
    expect(formatInstant(null)).toBe('—');
    expect(formatInstant('não é data')).toBe('—');
  });

  it('lista os papéis sem cotação, com o resto contado', () => {
    const missing = (...tickers: string[]) =>
      tickers.map((ticker) => ({
        asset_id: ticker,
        ticker,
        last_price_date: null,
      }));

    expect(missingPricesText(missing())).toBe('');
    expect(missingPricesText(missing('KNRI11'))).toBe('KNRI11 sem cotação do dia');
    expect(missingPricesText(missing('KNRI11', 'BTLG11'))).toBe(
      'KNRI11 e BTLG11 sem cotação do dia',
    );
    expect(missingPricesText(missing('A', 'B', 'C', 'D', 'E'))).toBe(
      'A, B e C e mais 2 sem cotação do dia',
    );
  });
});

describe('o backup', () => {
  it('desligado, diz que está desligado — e não "nenhum backup ainda"', () => {
    expect(backupSummary(backup({ enabled: false })).text).toBe(
      'Backup desligado nesta instalação',
    );
  });

  it('a falha vem com a data e a mensagem do erro', () => {
    expect(
      backupSummary(
        backup({
          last_failure: { at: '2026-10-08T06:00:09Z', error: 'bucket recusou o upload' },
        }),
      ),
    ).toEqual({
      text: 'Falhou em 08/10 03:00: bucket recusou o upload',
      tone: 'error',
    });
  });

  it('sucesso, pendente e nunca feito são três frases diferentes', () => {
    expect(backupSummary(backup({ last_success_at: '2026-10-08T06:01:00Z' }))).toEqual({
      text: 'Último backup em 08/10 03:01',
      tone: 'ok',
    });
    expect(backupSummary(backup({ pending: true })).text).toBe(
      'Backup pedido: aguardando a execução',
    );
    expect(backupSummary(backup({})).text).toBe('Nenhum backup feito ainda');
  });
});

describe('a instalação vazia', () => {
  it('sem carteira, categoria nem instituição é primeiro uso', () => {
    const empty = {
      portfolios: [],
      categories: [],
      institutions: [],
    } as unknown as Settings;

    expect(isEmptyInstallation(empty)).toBe(true);
    expect(
      isEmptyInstallation({ ...empty, institutions: [institution({})] } as Settings),
    ).toBe(false);
  });
});
