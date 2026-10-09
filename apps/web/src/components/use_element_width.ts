import { useEffect, useState } from 'react';

/**
 * Mede a largura de um elemento, para a tabela decidir quais colunas cabem
 * (D-04) e para o gráfico desenhar na largura certa (D-08).
 *
 * É a largura do elemento, e não a da janela: a mesma tabela aparece em tela
 * cheia e em meio painel, e a decisão de esconder coluna é sobre o espaço que
 * ela tem, não sobre o tamanho do monitor.
 */
export const useElementWidth = (
  ref: React.RefObject<HTMLElement | null>,
  fallback: number,
): number => {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const measure = (): void => {
      const measured = element.getBoundingClientRect().width;
      // No jsdom todo elemento mede zero; cair no padrão evita que o teste
      // esconda todas as colunas por engano.
      if (measured > 0) setWidth(measured);
    };

    measure();

    if (typeof globalThis.ResizeObserver !== 'function') return;
    const observer = new globalThis.ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, fallback]);

  return width;
};
