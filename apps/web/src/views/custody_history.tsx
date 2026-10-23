import type { AssetPageResource } from '@patrimonio/contracts';
import { useState } from 'react';

import { undoCustodyTransfer } from '../api/custody.js';
import { Button, Panel } from '../components/primitives.js';
import { formatDate } from '../lib/overview.js';

/**
 * O histórico de custódia de um ativo: de onde para onde ele foi e quando.
 *
 * Só aparece quando houve alguma transferência — um ativo que nunca saiu da
 * corretora onde foi comprado não precisa de um painel dizendo que não saiu.
 * Desfazer vale só para a mais recente: apagar uma do meio mudaria a origem das
 * seguintes.
 */
export const CustodyHistory = ({
  portfolioId,
  assetId,
  transfers,
  onChanged,
}: {
  readonly portfolioId: string;
  readonly assetId: string;
  readonly transfers: AssetPageResource['custody_transfers'];
  readonly onChanged: () => void;
}): React.ReactElement | null => {
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (transfers.length === 0) return null;

  const undo = (id: string): void => {
    setUndoing(true);
    setError(null);

    undoCustodyTransfer(portfolioId, assetId, id)
      .then(onChanged)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'A api não respondeu'),
      )
      .finally(() => setUndoing(false));
  };

  return (
    <Panel title="Histórico de custódia" hint="transferências entre instituições">
      <ul className="flex flex-col">
        {transfers.map((item, index) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[0.8125rem] first:border-t-0"
          >
            <span className="min-w-0">
              <span className="tabular text-ink-3">{formatDate(item.transfer_date)}</span>
              {' · '}
              {item.from_institution_name} → {item.to_institution_name}
              {item.note === null ? null : (
                <span className="text-ink-3"> · {item.note}</span>
              )}
            </span>
            {index === 0 ? (
              <Button variant="ghost" disabled={undoing} onClick={() => undo(item.id)}>
                {undoing ? 'Desfazendo…' : 'Desfazer'}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {error === null ? null : (
        <p
          role="alert"
          className="border-t border-line px-4 py-2.5 text-sm text-negative"
        >
          {error}
        </p>
      )}
    </Panel>
  );
};
