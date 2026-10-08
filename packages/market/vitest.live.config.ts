import { defineConfig } from 'vitest/config';

/**
 * A verificação noturna: só os arquivos que falam com as APIs reais. Separada da
 * suíte de commit de propósito — ela depende da internet, não bloqueia deploy, e
 * o que ela encontra abre issue em vez de quebrar build.
 */
export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/*.live.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
