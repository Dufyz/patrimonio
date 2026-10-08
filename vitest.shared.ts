import type { UserConfig } from 'vitest/config';

/**
 * Base herdada por todo pacote. Cada um estende com `mergeConfig` e declara
 * apenas o que é próprio dele — ambiente, setup e limite de cobertura.
 */
export const sharedTestConfig: UserConfig = {
  test: {
    globals: false,
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
    /**
     * `*.live.test.ts` fala com a internet e roda só na verificação noturna,
     * por `pnpm test:live`. Um teste de commit que depende de a brapi estar no
     * ar é um teste que ensina a equipe a ignorar vermelho.
     */
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.live.test.ts'],
    reporters: process.env.CI === 'true' ? ['dot'] : ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/testing/**',
        'src/__fixtures__/**',
      ],
    },
  },
};
