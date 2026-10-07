import { EnvironmentError, loadEnvironment } from './environment.js';
import type { Environment } from './environment.js';

/**
 * Lido uma vez, no boot do processo. Falha aqui derruba a subida nomeando a
 * variável — é o momento barato de descobrir que falta configuração.
 */
const load = (): Environment => {
  try {
    return loadEnvironment(process.env);
  } catch (error) {
    if (error instanceof EnvironmentError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }

    throw error;
  }
};

export const environment: Environment = load();

export { EnvironmentError, loadEnvironment };
export type { Environment };
