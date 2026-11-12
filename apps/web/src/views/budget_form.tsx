import { useState } from 'react';

import { Button } from '../components/primitives.js';
import { parseBudgetInput } from '../lib/goals_overview.js';

/**
 * "Quanto posso aportar por mês": o campo que simula um aporte qualquer. É o
 * mesmo nas duas telas de Objetivos — a de todas as carteiras e a de uma só.
 */
export const BudgetForm = ({
  placeholder,
  resetLabel,
  onSimulate,
  onReset,
}: {
  readonly placeholder: string;
  readonly resetLabel: string;
  readonly onSimulate: (monthly: string) => void;
  readonly onReset: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState('');
  const parsed = parseBudgetInput(draft);
  const invalid = draft.trim() !== '' && parsed === null;

  return (
    <form
      className="flex flex-wrap items-center gap-2 text-[0.8125rem]"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed !== null) onSimulate(parsed);
      }}
    >
      <label className="flex items-center gap-2 text-ink-2">
        Quanto posso aportar por mês
        <span className="tabular flex h-control items-center gap-1 rounded-control border border-line bg-panel px-2">
          R$
          <input
            inputMode="decimal"
            aria-invalid={invalid}
            value={draft}
            placeholder={placeholder}
            onChange={(event) => setDraft(event.target.value)}
            className="w-24 bg-transparent text-right outline-none"
          />
        </span>
      </label>
      <Button type="submit" disabled={parsed === null}>
        Simular
      </Button>
      {draft === '' ? null : (
        <Button
          onClick={() => {
            setDraft('');
            onReset();
          }}
        >
          {resetLabel}
        </Button>
      )}
      {invalid ? (
        <span role="alert" className="text-negative">
          Informe um valor maior que zero.
        </span>
      ) : null}
    </form>
  );
};
