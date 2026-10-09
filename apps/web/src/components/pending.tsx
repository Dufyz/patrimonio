import { useEffect, useRef } from 'react';

/**
 * D-06 · "Trocar de período não pisca a tela."
 *
 * O jeito fácil de carregar dados novos é esvaziar a tela e mostrar um giro.
 * Em uma tela densa isso custa caro: a tabela some, a página encolhe, a barra
 * de rolagem salta e quem estava lendo a terceira linha perde o lugar. Aqui o
 * conteúdo anterior fica — opaco e marcado como ocupado — até o novo chegar.
 *
 * O componente não busca nada: quem busca diz se está pendente. É só a regra
 * de o que mostrar enquanto isso.
 */
export const KeepPrevious = ({
  pending,
  children,
  className,
}: {
  readonly pending: boolean;
  readonly children: React.ReactNode;
  readonly className?: string | undefined;
}): React.ReactElement => {
  const previous = useRef<React.ReactNode>(children);

  useEffect(() => {
    if (!pending) previous.current = children;
  }, [pending, children]);

  return (
    <div
      aria-busy={pending}
      // `opacity` e não `visibility`: o conteúdo continua ocupando o mesmo
      // espaço, então nada se desloca quando o novo chega.
      className={`transition-opacity ${pending ? 'opacity-60' : ''} ${className ?? ''}`}
    >
      {pending ? previous.current : children}
    </div>
  );
};
