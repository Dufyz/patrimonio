import { defineConfig, mergeConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.js';

export default defineConfig(
  mergeConfig(sharedTestConfig, {
    test: {
      // Supertest sobre a app completa, com banco e fila reais: sem mock.
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 60_000,
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        WEB_ORIGIN: 'http://localhost:5173',
        DB_CONNECTION:
          process.env['DB_TEST_CONNECTION'] ??
          'postgres://patrimonio:patrimonio@localhost:5434/patrimonio_test',
        DB_TEST_CONNECTION:
          process.env['DB_TEST_CONNECTION'] ??
          'postgres://patrimonio:patrimonio@localhost:5434/patrimonio_test',
        REDIS_URL: process.env['REDIS_TEST_URL'] ?? 'redis://localhost:6380/1',
      },
    },
  }),
);
