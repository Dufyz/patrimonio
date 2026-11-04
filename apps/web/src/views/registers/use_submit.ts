import { useCallback, useState } from 'react';

/**
 * O ciclo de toda escrita de um modal de cadastro: pede, espera, mostra o que a
 * `api` recusou — com a razão em português que ela mesma devolve — e, se deu
 * certo, avisa quem abriu. `pending` trava um segundo envio enquanto o primeiro
 * não voltou, que é o jeito mais comum de criar a mesma carteira duas vezes.
 */
export const useSubmit = (
  action: () => Promise<unknown>,
  onDone: () => void,
): {
  readonly pending: boolean;
  readonly error: string | null;
  readonly submit: () => void;
  readonly clear: () => void;
} => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(() => {
    if (pending) return;
    setPending(true);
    setError(null);

    action()
      .then(() => {
        setPending(false);
        onDone();
      })
      .catch((cause: unknown) => {
        setPending(false);
        setError(cause instanceof Error ? cause.message : 'A api não respondeu');
      });
  }, [action, onDone, pending]);

  return { pending, error, submit, clear: () => setError(null) };
};
