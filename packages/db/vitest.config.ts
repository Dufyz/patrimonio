import { defineConfig, mergeConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.js';

export default defineConfig(
  mergeConfig(sharedTestConfig, {
    test: {
      // Postgres real, um banco compartilhado: sem paralelismo entre arquivos.
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 60_000,
      env: {
        NODE_ENV: 'test',
        WEB_ORIGIN: 'http://localhost:5173',
        DB_CONNECTION:
          process.env['DB_CONNECTION'] ??
          'postgres://patrimonio:patrimonio@localhost:5433/patrimonio',
        DB_TEST_CONNECTION:
          process.env['DB_TEST_CONNECTION'] ??
          'postgres://patrimonio:patrimonio@localhost:5434/patrimonio_test',
        REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6380',
      },
    },
  }),
);
