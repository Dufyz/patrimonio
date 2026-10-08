import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

/**
 * O jsdom não implementa `matchMedia`, e a resolução do tema "sistema" depende
 * dela. O padrão é claro; um teste que precise do escuro reescreve a função.
 */
if (typeof globalThis.matchMedia !== 'function') {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/**
 * `ResizeObserver` também falta, e os gráficos e a tabela o usam para medir o
 * contêiner. Observar nada é o comportamento certo aqui: no jsdom todo elemento
 * tem largura zero, e cada teste informa a largura de que precisa.
 */
if (typeof globalThis.ResizeObserver !== 'function') {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  });
}
