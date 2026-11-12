import { describe, expect, it } from 'vitest';

import { navIdForPlace, placeForPath, routes } from './routes.js';

describe('rotas unificadas (NAV-01)', () => {
  it('monta os caminhos sem prefixo de área', () => {
    expect(routes.home()).toBe('/');
    expect(routes.home('fluxo')).toBe('/?escopo=fluxo');
    expect(routes.home('investimentos', 'todas')).toBe('/?escopo=investimentos');
    expect(routes.home('investimentos', 'longo-prazo')).toBe(
      '/?escopo=investimentos&carteira=longo-prazo',
    );
    expect(routes.portfolio('longo-prazo', 'posicoes')).toBe(
      '/carteiras/longo-prazo/posicoes',
    );
    expect(routes.portfolio('longo-prazo', 'visao-geral')).toBe(
      '/?escopo=investimentos&carteira=longo-prazo',
    );
    expect(routes.asset('longo-prazo', 'divo11')).toBe(
      '/carteiras/longo-prazo/ativos/divo11',
    );
    expect(routes.settings()).toBe('/configuracoes');
  });

  it('nenhum caminho carrega o prefixo de uma área antiga', () => {
    const paths = [
      routes.home(),
      routes.home('fluxo'),
      routes.home('investimentos', 'x'),
      routes.portfolio('x', 'estrategia'),
      routes.asset('x', 'y'),
      routes.settings(),
    ];
    for (const path of paths)
      expect(path).not.toMatch(/\/(geral|financas|investimentos)\b/u);
  });

  it('lê a Visão geral e o escopo da consulta; escopo inválido cai em Tudo', () => {
    expect(placeForPath('/', '')).toEqual({
      kind: 'home',
      scope: 'tudo',
      portfolio: 'todas',
    });
    expect(placeForPath('/', '?escopo=fluxo')).toEqual({
      kind: 'home',
      scope: 'fluxo',
      portfolio: 'todas',
    });
    expect(placeForPath('/', '?escopo=investimentos&carteira=reserva')).toEqual({
      kind: 'home',
      scope: 'investimentos',
      portfolio: 'reserva',
    });
    expect(placeForPath('/', '?escopo=qualquer')).toMatchObject({ scope: 'tudo' });
  });

  it('lê as telas de fluxo, os detalhes e as de carteira', () => {
    expect(placeForPath('/lancamentos')).toEqual({ kind: 'flow', screen: 'lancamentos' });
    expect(placeForPath('/contas/abc')).toEqual({
      kind: 'flow',
      screen: 'contas',
      detail: 'abc',
    });
    expect(placeForPath('/carteiras/reserva/estrategia')).toEqual({
      kind: 'portfolios',
      scope: 'reserva',
      screen: 'estrategia',
    });
    expect(placeForPath('/carteiras/reserva/ativos/divo11')).toEqual({
      kind: 'portfolios',
      scope: 'reserva',
      screen: 'ativo',
    });
    expect(placeForPath('/configuracoes')).toEqual({ kind: 'settings' });
  });

  it('rotas antigas e inexistentes não são lugar nenhum', () => {
    for (const path of [
      '/geral',
      '/financas/contas',
      '/investimentos/todas/posicoes',
      '/nada',
    ]) {
      expect(placeForPath(path)).toEqual({ kind: 'unknown' });
    }
  });

  it('o detalhe destaca a tela de origem (NAV-06)', () => {
    expect(navIdForPlace(placeForPath('/contas/abc'))).toBe('contas');
    expect(navIdForPlace(placeForPath('/cartoes/abc'))).toBe('cartoes');
    expect(navIdForPlace(placeForPath('/carteiras/reserva/ativos/divo11'))).toBe(
      'posicoes',
    );
    expect(navIdForPlace(placeForPath('/', '?escopo=fluxo'))).toBe('visao-geral');
    expect(navIdForPlace(placeForPath('/nada'))).toBeNull();
  });
});
