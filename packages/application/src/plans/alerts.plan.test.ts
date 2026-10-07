import type { AlertInstance } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

import type { AlertFinding } from '../interfaces/alert.repository.js';
import { isVisibleOn, reconcileAlerts } from './alerts.plan.js';

const instance = (
  rule_kind: string,
  subject_id: string,
  overrides: Partial<AlertInstance> = {},
): AlertInstance => ({
  rule_kind,
  subject_id,
  portfolio_id: 'cart-1',
  status: 'open',
  snooze_until: null,
  payload: { valor: '1' },
  first_seen_at: '2024-03-01T00:00:00.000Z',
  updated_at: '2024-03-01T00:00:00.000Z',
  ...overrides,
});

const finding = (
  rule_kind: string,
  subject_id: string,
  payload: Record<string, unknown> = { valor: '2' },
): AlertFinding => ({
  rule_kind,
  subject_id,
  portfolio_id: 'cart-1',
  payload,
});

describe('o estado do usuário sobrevive ao recálculo', () => {
  it('alerta adiado continua adiado depois do recálculo', () => {
    const plan = reconcileAlerts({
      existing: [
        instance('preco_atrasado', 'itub4', {
          status: 'snoozed',
          snooze_until: '2024-04-01',
        }),
      ],
      findings: [finding('preco_atrasado', 'itub4')],
    });

    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]?.status).toBe('snoozed');
    expect(plan.upserts[0]?.snooze_until).toBe('2024-04-01');
    expect(plan.report.preserved).toBe(1);
  });

  it('alerta ignorado não reaparece para o mesmo item', () => {
    const plan = reconcileAlerts({
      existing: [instance('evento_corporativo', 'petr4', { status: 'ignored' })],
      findings: [finding('evento_corporativo', 'petr4')],
    });

    expect(plan.upserts[0]?.status).toBe('ignored');
    expect(plan.resolved).toEqual([]);
  });

  it('o texto do alerta é atualizado, e a decisão não', () => {
    const plan = reconcileAlerts({
      existing: [instance('preco_atrasado', 'itub4', { status: 'ignored' })],
      findings: [finding('preco_atrasado', 'itub4', { valor: '99', dias: 7 })],
    });

    // O payload é do motor; o status é do usuário.
    expect(plan.upserts[0]?.payload).toEqual({ valor: '99', dias: 7 });
    expect(plan.upserts[0]?.status).toBe('ignored');
  });

  it('ignorar vale para aquele item, não para a regra', () => {
    const plan = reconcileAlerts({
      existing: [instance('preco_atrasado', 'itub4', { status: 'ignored' })],
      findings: [finding('preco_atrasado', 'itub4'), finding('preco_atrasado', 'petr4')],
    });

    const petr4 = plan.upserts.find((row) => row.subject_id === 'petr4');

    expect(petr4?.status).toBe('open');
    expect(plan.report.opened).toBe(1);
  });
});

describe('a reconciliação é por regra e item', () => {
  it('o que apareceu de novo entra aberto', () => {
    const plan = reconcileAlerts({
      existing: [],
      findings: [finding('vencimento_proximo', 'cdb-1')],
    });

    expect(plan.report).toEqual({
      opened: 1,
      updated: 0,
      resolved: 0,
      preserved: 0,
    });
    expect(plan.upserts[0]?.status).toBe('open');
    expect(plan.upserts[0]?.snooze_until).toBeNull();
  });

  it('o que deixou de valer sai da lista', () => {
    const plan = reconcileAlerts({
      existing: [instance('preco_atrasado', 'itub4'), instance('preco_atrasado', 'petr4')],
      findings: [finding('preco_atrasado', 'itub4')],
    });

    expect(plan.resolved).toEqual([{ rule_kind: 'preco_atrasado', subject_id: 'petr4' }]);
    expect(plan.report.resolved).toBe(1);
  });

  it('o mesmo item em regras diferentes são dois alertas', () => {
    const plan = reconcileAlerts({
      existing: [instance('preco_atrasado', 'itub4', { status: 'ignored' })],
      findings: [finding('preco_atrasado', 'itub4'), finding('evento_corporativo', 'itub4')],
    });

    expect(plan.upserts).toHaveLength(2);
    expect(plan.upserts.find((row) => row.rule_kind === 'evento_corporativo')?.status).toBe(
      'open',
    );
  });

  it('nenhum achado resolve tudo o que havia', () => {
    const plan = reconcileAlerts({
      existing: [instance('preco_atrasado', 'itub4')],
      findings: [],
    });

    expect(plan.upserts).toEqual([]);
    expect(plan.resolved).toHaveLength(1);
  });

  it('sem nada de nenhum lado o plano é vazio', () => {
    expect(reconcileAlerts({ existing: [], findings: [] })).toEqual({
      upserts: [],
      resolved: [],
      report: { opened: 0, updated: 0, resolved: 0, preserved: 0 },
    });
  });
});

describe('o que o painel mostra', () => {
  it('aberto aparece; ignorado não', () => {
    expect(isVisibleOn(instance('r', 's'), '2024-03-10')).toBe(true);
    expect(isVisibleOn(instance('r', 's', { status: 'ignored' }), '2024-03-10')).toBe(
      false,
    );
  });

  it('adiado volta quando a data chega, e não antes', () => {
    const snoozed = instance('r', 's', {
      status: 'snoozed',
      snooze_until: '2024-03-15',
    });

    expect(isVisibleOn(snoozed, '2024-03-10')).toBe(false);
    expect(isVisibleOn(snoozed, '2024-03-15')).toBe(true);
    expect(isVisibleOn(snoozed, '2024-03-20')).toBe(true);
  });

  it('adiado sem data não volta: o banco recusa esse estado, e a tela também', () => {
    expect(
      isVisibleOn(instance('r', 's', { status: 'snoozed', snooze_until: null }), '2024-03-10'),
    ).toBe(false);
  });
});
