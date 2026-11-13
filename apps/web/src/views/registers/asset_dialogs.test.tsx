import type { AssetPageIdentity } from '@patrimonio/contracts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetDialog } from './asset_dialogs.js';

const api = vi.hoisted(() => ({
  updateAsset: vi.fn(),
  fetchCategories: vi.fn(),
}));

vi.mock('../../api/registers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/registers.js')>()),
  updateAsset: api.updateAsset,
  fetchCategories: api.fetchCategories,
}));
vi.mock('../../api/institutions.js', () => ({
  fetchInstitutions: vi.fn().mockResolvedValue([]),
}));

const identity = (overrides: Partial<AssetPageIdentity>): AssetPageIdentity => ({
  asset_id: 'aaaa1111-1111-4111-8111-111111111111',
  ticker: 'IVVB11',
  name: 'iShares S&P 500',
  origin: 'market',
  b3_type: 'etf',
  etf_exposure: null,
  sector: null,
  price_source: 'auto',
  category_id: null,
  category_name: null,
  color_token: null,
  category_automatic: false,
  issuer_id: null,
  issuer_name: null,
  archived_at: null,
  indexer: null,
  rate: null,
  issued_at: null,
  maturity_date: null,
  liquidity: null,
  liquidity_days: null,
  tax_regime: null,
  redemption_rule: null,
  lot_term_months: null,
  ...overrides,
});

const open = (asset: AssetPageIdentity): void => {
  render(
    <AssetDialog
      asset={asset}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      onDelete={vi.fn()}
      onArchive={vi.fn()}
    />,
  );
};

describe('EST-02 · exposição do ETF no cadastro do ativo', () => {
  beforeEach(() => {
    api.fetchCategories.mockResolvedValue([]);
    api.updateAsset.mockResolvedValue({});
  });
  afterEach(() => vi.clearAllMocks());

  it('ETF pede o que ele expõe e grava a escolha', async () => {
    const user = userEvent.setup();
    open(identity({}));

    await user.selectOptions(
      screen.getByLabelText('O que o ETF expõe'),
      'acoes_exterior',
    );
    await user.click(screen.getByRole('button', { name: /^Salvar/ }));

    await waitFor(() => expect(api.updateAsset).toHaveBeenCalled());
    expect(api.updateAsset.mock.calls[0]?.[1]).toMatchObject({
      etf_exposure: 'acoes_exterior',
    });
  });

  it('ação não tem o campo, e o corpo não carrega a exposição', async () => {
    const user = userEvent.setup();
    open(identity({ ticker: 'ITUB4', b3_type: 'stock' }));

    expect(screen.queryByLabelText('O que o ETF expõe')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Salvar/ }));

    await waitFor(() => expect(api.updateAsset).toHaveBeenCalled());
    expect(api.updateAsset.mock.calls[0]?.[1]).not.toHaveProperty('etf_exposure');
  });
});
