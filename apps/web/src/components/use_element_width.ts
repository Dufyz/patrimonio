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

/**
 * A largura da janela, que é o que decide quais colunas a tabela densa larga.
 *
 * As etapas de D-04 vêm da prancha 18, e lá elas são consultas de mídia: é o
 * tamanho da tela que diz se cabe "preço médio", não o do elemento. Medir o
 * contêiner escondia três colunas num monitor de 1440 px, porque a barra
 * lateral e o respiro do conteúdo comem trezentos deles — a tabela teria 1.140
 * e a etapa de 1.400 dispararia com a tela inteira à vista.
 *
 * O gráfico continua medindo o próprio elemento: ele precisa saber onde
 * desenhar, e isso é mesmo sobre o espaço que ele tem.
 */
export const useViewportWidth = (fallback: number): number => {
  const [width, setWidth] = useState(() => globalThis.innerWidth || fallback);

  useEffect(() => {
    const measure = (): void => setWidth(globalThis.innerWidth || fallback);
    measure();
    globalThis.addEventListener('resize', measure);
    return () => globalThis.removeEventListener('resize', measure);
  }, [fallback]);

  return width;
};
