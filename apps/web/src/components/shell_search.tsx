import { createContext, useContext, useEffect } from 'react';

/**
 * A busca abre pelo botão da barra lateral, que mora na casca; quem sabe o que
 * ela procura é a área aberta. A área registra aqui o que a abre.
 */
export type ShellSearch = {
  readonly register: (open: (() => void) | null) => void;
};

export const ShellSearchContext = createContext<ShellSearch>({
  register: () => undefined,
});

export const useRegisterSearch = (open: () => void): void => {
  const { register } = useContext(ShellSearchContext);
  useEffect(() => {
    register(open);
    return () => register(null);
  }, [register, open]);
};
