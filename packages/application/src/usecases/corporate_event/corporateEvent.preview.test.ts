import type { DateOnly } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import { previewCorporateEvent } from './corporateEvent.usecases.js';

const buy = (portfolio: string, date: string, quantity: string, price: string) => ({
  kind: 'buy' as const,
  trade_date: date,
  quantity,
  unit_price: price,
  fees: '0',
  net_amount: (Number(quantity) * Number(price)).toFixed(2),
  portfolio_id: portfolio,
  asset_id: 'ativo',
  institution_id: 'corretora',
});

const unitOfWorkWith = (entries: ReturnType<typeof buy>[], assetExists = true) => {
  const repositories = {
    assets: {
      findById: async () => success(assetExists ? { id: 'ativo' } : null),
    },
    ledger: { entriesForAsset: async () => success(entries) },
    portfolios: {
      list: async () =>
        success([
          { id: 'a', name: 'Longo prazo' },
          { id: 'b', name: 'Reserva' },
        ]),
    },
  } as unknown as TransactionalRepositories;

  const unitOfWork: UnitOfWork = { run: async (work) => work(repositories) as never };
  return unitOfWork;
};

const input = (overrides: Record<string, string> = {}) => ({
  asset_id: 'ativo',
  record_date: '2026-06-10' as DateOnly,
  ratio_from: '1',
  ratio_to: '2',
  ...overrides,
});

describe('previewCorporateEvent', () => {
  it('desdobramento dobra a quantidade, divide o preço médio e mantém o custo', async () => {
    const result = await previewCorporateEvent({
      unitOfWork: unitOfWorkWith([buy('a', '2026-01-10', '100', '30')]),
    })(input());

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;

    expect(result.value.portfolios).toEqual([
      {
        portfolio_id: 'a',
        portfolio_name: 'Longo prazo',
        quantity: { before: '100.00000000', after: '200.00000000' },
        avg_price: { before: '30.00000000', after: '15.00000000' },
        cost_basis: { before: '3000.00', after: '3000.00' },
      },
    ]);
  });

  it('grupamento deixa a sobra como fração, sem perda de custo', async () => {
    const result = await previewCorporateEvent({
      unitOfWork: unitOfWorkWith([
        buy('a', '2026-01-10', '100', '30'),
        buy('a', '2026-02-10', '5', '30'),
      ]),
    })(input({ ratio_from: '10', ratio_to: '1' }));

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;

    expect(result.value.portfolios[0]?.quantity.after).toBe('10.50000000');
    expect(result.value.portfolios[0]?.cost_basis).toEqual({
      before: '3150.00',
      after: '3150.00',
    });
  });

  it('só traz as carteiras que tinham posição na data-com', async () => {
    const result = await previewCorporateEvent({
      unitOfWork: unitOfWorkWith([
        buy('a', '2026-01-10', '100', '30'),
        buy('b', '2026-07-01', '50', '30'),
      ]),
    })(input());

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;

    expect(result.value.portfolios.map((row) => row.portfolio_id)).toEqual(['a']);
  });

  it('sem nenhuma posição na data-com, recusa', async () => {
    const result = await previewCorporateEvent({
      unitOfWork: unitOfWorkWith([buy('a', '2026-07-01', '100', '30')]),
    })(input());

    expect(result.isFailure()).toBe(true);
  });

  it('ativo inexistente, recusa', async () => {
    const result = await previewCorporateEvent({
      unitOfWork: unitOfWorkWith([], false),
    })(input());

    expect(result.isFailure()).toBe(true);
  });
});
