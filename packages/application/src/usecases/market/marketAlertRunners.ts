import { success } from '@patrimonio/shared';

import { CORPORATE_EVENT_RULE } from '../../plans/market.plan.js';
import type { AlertFinding } from '../../interfaces/alert.repository.js';
import type { AlertRuleRunner } from '../pipeline/reconcileAlerts.usecase.js';

/**
 * Os executores de regra que a ingestão de mercado liga. Eles entram no mesmo
 * motor de reconciliação das treze regras de E7, e é dele que vem a propriedade
 * que importa: o estado que o usuário mexeu sobrevive. Ignorar um evento o tira
 * da fila **sem reaparecer** no fechamento seguinte, porque a reconciliação é
 * por `(rule_kind, subject_id)` em vez de apagar e regravar.
 *
 * ## Por que o evento corporativo é alerta e não aplicação automática
 *
 * Um desdobramento aplicado com data errada reescreve preço médio e resultado
 * realizado de todo o histórico do papel — e o erro não aparece como erro,
 * aparece como número. A quantidade em carteira só muda depois da confirmação do
 * usuário, que é um clique contra uma reescrita de dez anos.
 */
export const corporateEventRunner: AlertRuleRunner = async (
  repositories,
  { reference_date },
) => {
  const pending = await repositories.corporateEvents.list({ pending: true });
  if (pending.isFailure()) return pending;

  const findings: AlertFinding[] = pending.value
    // Evento com data-com no futuro ainda não é decisão de hoje.
    .filter((event) => event.record_date <= reference_date)
    .map((event) => ({
      rule_kind: CORPORATE_EVENT_RULE,
      subject_id: event.id,
      portfolio_id: null,
      payload: {
        asset_id: event.asset_id,
        kind: event.kind,
        record_date: event.record_date,
        // Os termos detectados, para o usuário confirmar o que vai ser aplicado
        // em vez de confiar no aviso.
        ratio_from: event.ratio_from,
        ratio_to: event.ratio_to,
      },
    }));

  return success(findings);
};

/** As regras que E4 liga, por `kind`. E7 acrescenta as suas ao mesmo mapa. */
export const marketAlertRunners: Readonly<Record<string, AlertRuleRunner>> = {
  [CORPORATE_EVENT_RULE]: corporateEventRunner,
};
