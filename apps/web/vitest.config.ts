import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.js';

export default defineConfig(
  mergeConfig(sharedTestConfig, {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      // Componente é `.tsx`; a base do monorepo só inclui `.ts` porque todo o
      // resto do repositório roda no Node.
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['./src/testing/setup.ts'],
      coverage: {
        // `web` tem piso de 60% (`Estratégia de testes`): `lib/` e formatação
        // com cobertura alta, o resto no caminho principal.
        thresholds: { lines: 60, branches: 60 },
      },
    },
  }),
);
