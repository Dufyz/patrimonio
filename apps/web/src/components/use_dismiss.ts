import { useEffect, useRef } from 'react';

/**
 * D-12 · Toda sobreposição fecha com Esc e com clique fora.
 *
 * Fica em um lugar só porque é a regra que mais se esquece em um componente
 * novo: um menu que não fecha com Esc parece quebrado, e descobrir isso depois
 * significa encontrar todos os menus de novo.
 *
 * Quem chama devolve o foco ao elemento que abriu a sobreposição — a outra
 * metade da regra, que o componente de origem conhece e este não.
 */
export const useDismiss = (
  container: React.RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
): void => {
  // O retorno de chamada costuma ser uma função nova a cada render; guardá-lo
  // em uma referência evita registrar e remover os ouvintes a cada quadro.
  const latest = useRef(onDismiss);
  latest.current = onDismiss;

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Um Esc dentro de um menu aberto não deve também fechar o modal atrás
      // dele: fecha uma camada por vez.
      event.stopPropagation();
      latest.current();
    };

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (container.current?.contains(target) === true) return;
      latest.current();
    };

    globalThis.document.addEventListener('keydown', onKeyDown);
    globalThis.document.addEventListener('mousedown', onPointerDown);

    return () => {
      globalThis.document.removeEventListener('keydown', onKeyDown);
      globalThis.document.removeEventListener('mousedown', onPointerDown);
    };
  }, [container, open]);
};
