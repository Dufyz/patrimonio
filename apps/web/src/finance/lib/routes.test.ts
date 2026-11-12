import { describe, expect, it } from 'vitest';

import { financeRoutes, screenForPath } from './routes.js';

describe('rotas de Finanças', () => {
  it('monta os caminhos das telas', () => {
    expect(financeRoutes.overview()).toBe('/?escopo=fluxo');
    expect(financeRoutes.account('itau')).toBe('/contas/itau');
    expect(financeRoutes.card('nubank-mc', '2026-11')).toBe(
      '/cartoes/nubank-mc?fatura=2026-11',
    );
    expect(financeRoutes.entries('conta=itau')).toBe('/lancamentos?conta=itau');
  });

  it('destaca a tela de origem nas telas de detalhe', () => {
    expect(screenForPath('/contas/itau')).toBe('contas');
    expect(screenForPath('/cartoes/nubank-mc')).toBe('cartoes');
    expect(screenForPath('/lancamentos')).toBe('lancamentos');
    expect(screenForPath('/')).toBe('visao-geral');
  });
});
