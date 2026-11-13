import { useEffect, useState } from 'react';

import { confirmPlanned } from '../../api/book.js';
import { AlertModal } from '../../components/overlay.js';
import {
  centsToDecimal,
  parseAmountInput,
  suggestedDate,
} from '../../lib/planned_confirm.js';

export type PlannedToLaunch = {
  readonly id: string;
  readonly description: string;
  readonly date: string;
  /** Centavos estimados; `null` quando o previsto não tem valor. */
  readonly cents: string | null;
};

/**
 * LAN-06 · "Lançar" um previsto com o valor real. Usado pela tela Lançamentos
 * e pelo painel Próximos lançamentos da Visão geral (VGR-15).
 */
export const LaunchPlannedDialog = ({
  planned,
  today,
  onClose,
  onDone,
}: {
  readonly planned: PlannedToLaunch | null;
  readonly today: string;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): React.ReactElement => {
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (planned === null) return;
    setDate(suggestedDate(planned.date, today));
    setAmount(planned.cents === null ? '' : centsToDecimal(planned.cents));
    setError(null);
  }, [planned, today]);

  const submit = (): void => {
    if (planned === null) return;
    const parsed = parseAmountInput(amount);
    if (parsed === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Informe uma data e um valor maiores que zero.');
      return;
    }
    if (date > today) {
      setError('Data futura não vira lançado: deixe como previsto.');
      return;
    }
    setBusy(true);
    confirmPlanned(planned.id, { date, amount: parsed })
      .then(() => {
        onClose();
        onDone();
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Não foi possível lançar'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <AlertModal
      open={planned !== null}
      title={`Lançar ${planned?.description ?? ''}`}
      message={
        <span className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            Data
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-field border border-line bg-field px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            Valor real
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="rounded-field border border-line bg-field px-2 py-1.5"
            />
          </label>
          <span className="text-ink-3">O valor cadastrado do recorrente não muda.</span>
          {error === null ? null : (
            <span role="alert" className="text-negative">
              {error}
            </span>
          )}
        </span>
      }
      cancelLabel="Cancelar"
      confirmLabel="Lançar"
      danger={false}
      pending={busy}
      onCancel={onClose}
      onConfirm={submit}
    />
  );
};
