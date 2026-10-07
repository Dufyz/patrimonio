import { healthCheckResourceSchema } from '@patrimonio/contracts';
import type { HealthCheckResource } from '@patrimonio/contracts';

/**
 * O contrato é importado, não combinado: este é o mesmo schema que a api usa
 * para recusar uma request e do qual sai a documentação. Renomear um campo
 * quebra o typecheck dos dois lados, no mesmo commit.
 */
export const fetchHealth = async (): Promise<HealthCheckResource> => {
  const response = await fetch('/api/health-check');

  return healthCheckResourceSchema.parse(await response.json());
};
