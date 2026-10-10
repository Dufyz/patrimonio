import { useCallback, useEffect, useRef, useState } from 'react';

import type { SaveReceipt } from '../../api/entry.js';
import { newAttemptKey } from '../../lib/entry.js';

/**
 * T-10 · O preview, sem piscar.
 *
 * Cada tecla muda o formulário, e cada formulário válido pede um preview. Três
 * regras evitam que isso vire um tiroteio contra a `api`:
 *
 * - **espera a pessoa parar de digitar** (`delayMs`): o preview de `1`, `10` e
 *   `100` é o preview de `100` com dois pedidos desperdiçados;
 * - **cancela o pedido anterior** quando o corpo muda: a resposta que chega
 *   atrasada de um corpo antigo nunca sobrescreve a do corpo atual;
 * - **mantém o resultado anterior enquanto o novo chega**, como as telas fazem —
 *   a tabela do efeito não pisca a cada tecla.
 *
 * `key` identifica o corpo: `null` é "formulário ainda inválido", e nesse caso
 * nada é pedido. Quem chama passa a serialização do corpo, não o objeto, para o
 * efeito não disparar a cada render.
 */
export type PreviewState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly previous: T | null }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'error'; readonly message: string };

export const PREVIEW_DELAY_MS = 250;

export const usePreview = <T>(
  key: string | null,
  run: (signal: AbortSignal) => Promise<T>,
  delayMs: number = PREVIEW_DELAY_MS,
): PreviewState<T> => {
  const [state, setState] = useState<PreviewState<T>>({ status: 'idle' });
  const runner = useRef(run);
  runner.current = run;

  useEffect(() => {
    if (key === null) {
      setState({ status: 'idle' });
      return;
    }

    const controller = new AbortController();

    // O resultado anterior fica na tela enquanto o novo chega; só "idle" e
    // "error" não têm o que manter.
    setState((current) => ({
      status: 'loading',
      previous:
        current.status === 'ready'
          ? current.value
          : current.status === 'loading'
            ? current.previous
            : null,
    }));

    const timer = setTimeout(() => {
      runner
        .current(controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setState({ status: 'ready', value });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'A api não respondeu',
          });
        });
    }, delayMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, delayMs]);

  return state;
};

/** O que o preview mostra agora: o valor novo, ou o anterior enquanto o novo chega. */
export const previewValue = <T>(state: PreviewState<T>): T | null =>
  state.status === 'ready'
    ? state.value
    : state.status === 'loading'
      ? state.previous
      : null;

/**
 * T-10 · Salvar, uma vez.
 *
 * A chave de idempotência é da **tentativa**, não do render: ⌘↵ apertado duas
 * vezes, ou o clique duplo, chega à `api` como o mesmo pedido e vira um
 * lançamento só. A chave só é trocada depois de um sucesso — se a rede caiu no
 * meio, repetir com a mesma chave é exatamente o que a protege de gravar duas
 * vezes o que a primeira tentativa já gravou.
 */
export const useSave = (): {
  readonly pending: boolean;
  readonly error: string | null;
  readonly run: (
    send: (attemptKey: string) => Promise<SaveReceipt>,
  ) => Promise<SaveReceipt | null>;
  readonly clearError: () => void;
} => {
  const attempt = useRef(newAttemptKey());
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (
      send: (attemptKey: string) => Promise<SaveReceipt>,
    ): Promise<SaveReceipt | null> => {
      // `pending` é estado e chega com um render de atraso; o duplo ⌘↵ não espera.
      if (inFlight.current) return null;
      inFlight.current = true;
      setPending(true);
      setError(null);

      try {
        const receipt = await send(attempt.current);
        attempt.current = newAttemptKey();
        return receipt;
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : 'A api não respondeu');
        return null;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return { pending, error, run, clearError };
};

/**
 * ⌘↵ salva, ⇧↵ salva e abre outro. Os botões do formulário são `type="button"`
 * de propósito: Enter solto num campo de texto não pode salvar — digitar o preço
 * e apertar Enter por hábito gravaria o lançamento com a taxa ainda em branco.
 */
export const submitKeys =
  (onSave: () => void, onSaveAgain?: () => void) =>
  (event: React.KeyboardEvent): void => {
    if (event.key !== 'Enter') return;

    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      onSave();
    } else if (event.shiftKey && onSaveAgain !== undefined) {
      event.preventDefault();
      onSaveAgain();
    }
  };
