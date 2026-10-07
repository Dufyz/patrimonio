import { Redis } from 'ioredis';

/**
 * Conexão Redis compartilhada por todas as filas. Uma só, porque o BullMQ
 * multiplexa comandos sobre ela e abrir uma por fila só gasta file descriptor.
 */
export type RedisConnection = Redis;

export const createRedisConnection = (url: string): RedisConnection =>
  new Redis(url, {
    // O BullMQ exige null: com um limite, um comando bloqueante que estoura a
    // contagem viraria job perdido em silêncio.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });

/** Verificado separadamente do Postgres no healthcheck profundo. */
export const pingRedis = async (connection: RedisConnection): Promise<boolean> => {
  try {
    return (await connection.ping()) === 'PONG';
  } catch {
    return false;
  }
};

export const closeRedisConnection = async (
  connection: RedisConnection,
): Promise<void> => {
  try {
    await connection.quit();
  } catch {
    connection.disconnect();
  }
};
