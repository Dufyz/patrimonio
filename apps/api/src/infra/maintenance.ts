import type { RequestHandler } from 'express';

/**
 * BKP-03 · Modo de manutenção. Enquanto a restauração troca o banco, toda
 * escrita é recusada com 503: uma gravação no meio do `pg_restore` ou seria
 * perdida ou travaria atrás dele. Leituras seguem; a rota de restauração é a
 * única escrita que passa, e só ela liga e desliga o modo.
 */
export type Maintenance = {
  readonly active: () => boolean;
  /** Liga o modo durante `work` e o desliga ao fim, com sucesso ou falha. */
  readonly during: <T>(work: () => Promise<T>) => Promise<T>;
  readonly middleware: RequestHandler;
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const RESTORE_PATH = '/api/backup/restore';

export const createMaintenance = (): Maintenance => {
  let on = false;

  return {
    active: () => on,
    during: async (work) => {
      on = true;
      try {
        return await work();
      } finally {
        on = false;
      }
    },
    middleware: (request, response, next) => {
      if (!on || SAFE_METHODS.has(request.method) || request.path === RESTORE_PATH) {
        next();
        return;
      }
      response.status(503).json({
        code: 'MANUTENCAO',
        message:
          'O app está em manutenção: uma restauração de backup está em andamento. Tente de novo em instantes.',
      });
    },
  };
};

/** Um só por processo: a middleware e a restauração precisam enxergar o mesmo. */
export const maintenance = createMaintenance();
