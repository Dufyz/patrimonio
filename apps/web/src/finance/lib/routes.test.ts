import { describe, expect, it } from 'vitest';

import { financeRoutes, screenForPath } from './routes.js';

describe('rotas de Finanças', () => {
  it('monta os caminhos das telas', () => {
    expect(financeRoutes.overview()).toBe('/financas/visao-geral');
    expect(financeRoutes.account('itau')).toBe('/financas/contas/itau');
    expect(financeRoutes.card('nubank-mc', '2026-11')).toBe(
      '/financas/cartoes/nubank-mc?fatura=2026-11',
    );
    expect(financeRoutes.entries('conta=itau')).toBe('/financas/lancamentos?conta=itau');
  });

  it('destaca a tela de origem nas telas de detalhe', () => {
    expect(screenForPath('/financas/contas/itau')).toBe('contas');
    expect(screenForPath('/financas/cartoes/nubank-mc')).toBe('cartoes');
    expect(screenForPath('/financas/lancamentos')).toBe('lancamentos');
    expect(screenForPath('/financas')).toBe('visao-geral');
  });
});
