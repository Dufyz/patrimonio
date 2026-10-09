import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Três estados, nenhum outro: `loading`, `error` e `ready`.
 *
 * Tela em branco não é estado e dado fixo de protótipo não é estado. O vazio
 * de uma lista é um `ready` com lista vazia, e é a tela que decide o que
 * dizer — uma tabela vazia porque a `api` caiu e uma tabela vazia porque não
 * há lançamento são coisas diferentes, e confundi-las faz a tela mentir sem
 * dizer nada falso.
 *
 * `pending` acompanha os três: trocar o período relê sem voltar para
 * `loading`, para o conteúdo anterior ficar na tela enquanto o novo chega
 * (`KeepPrevious`). Numa tela densa, esvaziar e mostrar um giro faz a tabela
 * sumir, a página encolher e quem estava lendo perder o lugar.
 *
 * A versão completa — releitura periódica, `ETag`, compasso vindo do dado — é
 * W-05, do backlog de correção.
 */
export type ResourceState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: Error }
  | { readonly kind: 'ready'; readonly value: T };

export type Resource<T> = {
  readonly state: ResourceState<T>;
  /** Verdadeiro durante uma releitura, com o conteúdo anterior ainda na tela. */
  readonly pending: boolean;
  readonly reload: () => void;
};

export const useResource = <T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): Resource<T> => {
  const [state, setState] = useState<ResourceState<T>>({ kind: 'loading' });
  const [pending, setPending] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);

    loader
      .current(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'ready', value });
        setPending(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // Uma falha na releitura não apaga o que já está na tela: a tela só
        // vira erro quando nunca chegou a ter dado.
        setState((current) =>
          current.kind === 'ready'
            ? current
            : {
                kind: 'error',
                error: error instanceof Error ? error : new Error(String(error)),
              },
        );
        setPending(false);
      });

    return () => controller.abort();
    // As dependências são as que identificam o recurso — carteira, período,
    // filtro —, e quem as declara é quem chama. A função de carga fica fora:
    // ela é recriada a cada render, e incluí-la recarregaria a tela sem
    // parar.
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  return { state, pending, reload };
};
