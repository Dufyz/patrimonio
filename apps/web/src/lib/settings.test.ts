import type {
  Settings,
  SettingsBackup,
} from '@patrimonio/contracts';
import { describe, expect, it } from 'vitest';

import {
  ALERT_COPY,
  alertCopy,
  alertLimit,
  backupSummary,
  formatInstant,
  isEmptyInstallation,
  missingPricesText,
  portfolioHold,
  sectionFromParam,
  sortAlerts,
} from './settings.js';

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
  it('sem carteira é primeiro uso', () => {
    const empty = { portfolios: [] } as unknown as Settings;

    expect(isEmptyInstallation(empty)).toBe(true);
    expect(
      isEmptyInstallation({ portfolios: [{ id: 'p' }] } as unknown as Settings),
    ).toBe(false);
  });
});
