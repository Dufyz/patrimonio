import { describe, expect, it } from 'vitest';

import { EnvironmentError, loadEnvironment } from './environment.js';

const minimum = {
  WEB_ORIGIN: 'http://localhost:5173',
  DB_CONNECTION: 'postgres://patrimonio:patrimonio@localhost:5433/patrimonio',
  REDIS_URL: 'redis://localhost:6380',
};

describe('loadEnvironment', () => {
  it('agrupa as variáveis por assunto', () => {
    const environment = loadEnvironment({ ...minimum, API_PORT: '4000' });

    expect(environment.server.apiPort).toBe(4000);
    expect(environment.database.connection).toContain('5433');
    expect(environment.redis.url).toBe('redis://localhost:6380');
    expect(environment.pipeline.relayPollMs).toBe(1_000);
    expect(environment.backup.enabled).toBe(false);
  });

  it('variável faltando falha nomeando qual', () => {
    const run = () => loadEnvironment({ WEB_ORIGIN: minimum.WEB_ORIGIN });

    expect(run).toThrow(EnvironmentError);
    expect(run).toThrow(/DB_CONNECTION/);
    expect(run).toThrow(/REDIS_URL/);
  });

  it('variável inválida falha nomeando qual', () => {
    const run = () => loadEnvironment({ ...minimum, API_PORT: 'três mil' });

    expect(run).toThrow(/API_PORT/);
  });

  it('origem do web precisa ser uma URL', () => {
    expect(() => loadEnvironment({ ...minimum, WEB_ORIGIN: 'localhost' })).toThrow(
      /WEB_ORIGIN/,
    );
  });

  it('backup ligado sem chave nem destino não sobe', () => {
    const run = () => loadEnvironment({ ...minimum, BACKUP_ENABLED: 'true' });

    expect(run).toThrow(/BACKUP_PUBLIC_KEY/);
    expect(run).toThrow(/BACKUP_STORAGE_URL/);
    expect(run).toThrow(/BACKUP_STORAGE_TOKEN/);
  });

  it('backup ligado com tudo declarado sobe', () => {
    const environment = loadEnvironment({
      ...minimum,
      BACKUP_ENABLED: 'true',
      BACKUP_PUBLIC_KEY: 'age1qwerty',
      BACKUP_STORAGE_URL: 'https://projeto.supabase.co/storage/v1',
      BACKUP_STORAGE_TOKEN: 'token',
    });

    expect(environment.backup.enabled).toBe(true);
    expect(environment.backup.bucket).toBe('backups');
  });

  it('variável opcional vazia no .env conta como não definida', () => {
    const environment = loadEnvironment({
      ...minimum,
      MARKET_BRAPI_TOKEN: '',
      BACKUP_STORAGE_URL: '',
      DB_TEST_CONNECTION: '',
    });

    expect(environment.market.brapiToken).toBeUndefined();
    expect(environment.backup.storageUrl).toBeUndefined();
    expect(environment.database.testConnection).toBeUndefined();
  });

  it('variável obrigatória vazia continua sendo erro', () => {
    expect(() => loadEnvironment({ ...minimum, DB_CONNECTION: '' })).toThrow(
      /DB_CONNECTION/,
    );
  });

  it('o pool da api e o do worker são independentes', () => {
    const environment = loadEnvironment({
      ...minimum,
      DB_POOL_API: '20',
      DB_POOL_WORKER: '3',
    });

    expect(environment.database.poolApi).toBe(20);
    expect(environment.database.poolWorker).toBe(3);
  });
});
