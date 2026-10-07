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
