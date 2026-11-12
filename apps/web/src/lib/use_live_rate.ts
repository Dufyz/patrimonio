import { useEffect, useRef, useState } from 'react';

import { normalizeRateInput } from './goals.js';

/**
 * A rentabilidade que se digita e já simula, como na Projeção: nada de botão.
 * Vazio volta à premissa; texto inválido avisa e não simula; o que é válido
 * sobe depois de uma pausa na digitação, para não pedir uma projeção por tecla.
 */
export const useLiveRate = (
  applied: string | null,
  commit: (rate: string | null) => void,
  delay = 400,
): {
  readonly draft: string;
  readonly setDraft: (draft: string) => void;
  readonly invalid: boolean;
} => {
  const [draft, setDraft] = useState(applied ?? '');
  const latest = useRef(commit);
  latest.current = commit;

  const empty = draft.trim() === '';
  const parsed = empty ? null : normalizeRateInput(draft);
  const invalid = !empty && parsed === null;

  // Quem aplicou a taxa (o "voltar à premissa", por exemplo) limpa o campo.
  useEffect(() => {
    if (applied === null) setDraft('');
  }, [applied]);

  useEffect(() => {
    if (invalid || parsed === applied) return undefined;

    const timer = setTimeout(() => latest.current(parsed), delay);

    return () => clearTimeout(timer);
  }, [parsed, invalid, applied, delay]);

  return { draft, setDraft, invalid };
};
