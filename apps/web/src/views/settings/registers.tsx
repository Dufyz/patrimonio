import type { Settings, SettingsPortfolio } from '@patrimonio/contracts';
import { useState } from 'react';

import { Button } from '../../components/primitives.js';
import {
  DeletePortfolioDialog,
  PortfolioDialog,
} from '../registers/portfolio_dialogs.js';
import { notifyPortfoliosChanged } from '../../lib/portfolio_events.js';
import {
  alertCopy,
  alertLimit,
  plural,
  portfolioHold,
  sortAlerts,
} from '../../lib/settings.js';
import {
  EditButton,
  Muted,
  ROW,
  SettingsSection,
  Switch,
  TD,
  TH,
  TH_RIGHT,
} from './parts.js';

/**
 * As seções de cadastro: carteiras e alertas. Nenhuma faz conta — contagem, soma e percentual chegam da `api`
 * —; criar, editar e excluir são modais (`views/registers`), e cada um relê as
 * configurações ao terminar.
 * O que cada linha mostra é o que o servidor usa para bloquear a exclusão, para
 * o bloqueio chegar explicado e não como um erro depois do clique.
 */

type Editing<T> =
  | { readonly kind: 'none' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly item: T }
  | { readonly kind: 'delete'; readonly item: T };

const NONE = { kind: 'none' } as const;

export const PortfoliosSection = ({
  settings,
  onChanged,
}: {
  readonly settings: Settings;
  readonly onChanged: () => void;
}): React.ReactElement => {
  const [editing, setEditing] = useState<Editing<SettingsPortfolio>>(NONE);
  const done = (): void => {
    setEditing(NONE);
    notifyPortfoliosChanged();
    onChanged();
  };

  return (
    <>
      <SettingsSection
        id="carteiras"
        title="Carteiras"
        description="Uma carteira separa o dinheiro por propósito. Cada uma tem estratégia e objetivos próprios, e cada posição pertence a uma carteira só. A ordem aqui é a ordem da barra lateral."
        action={
          <Button icon="plus" onClick={() => setEditing({ kind: 'create' })}>
            Nova carteira
          </Button>
        }
      >
        {settings.portfolios.length === 0 ? (
          <p className="p-4 text-[0.8125rem] text-ink-3">
            Nenhuma carteira ainda. Crie a primeira para começar a lançar.
          </p>
        ) : (
          <table className="w-full text-[0.8125rem] whitespace-nowrap">
            <caption className="sr-only">Carteiras abertas</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  Carteira
                </th>
                <th scope="col" className={TH}>
                  Estratégia
                </th>
                <th scope="col" className={TH}>
                  Conteúdo
                </th>
                <th scope="col" className="w-12" />
              </tr>
            </thead>
            <tbody>
              {settings.portfolios.map((portfolio) => {
                const hold = portfolioHold(portfolio.blocking);

                return (
                  <tr key={portfolio.id} className={ROW}>
                    <th scope="row" className={`${TD} text-left font-medium`}>
                      {portfolio.name}
                    </th>
                    <td className={TD}>
                      {portfolio.strategy_categories === 0 ? (
                        <Muted>sem estratégia</Muted>
                      ) : (
                        plural(portfolio.strategy_categories, 'categoria', 'categorias')
                      )}
                    </td>
                    <td className={TD}>
                      {hold === null ? (
                        <Muted>vazia</Muted>
                      ) : (
                        <span title="Excluir a carteira exclui também estes lançamentos">
                          {hold}
                        </span>
                      )}
                    </td>
                    <td className="pr-4 text-right">
                      <EditButton
                        label={`a carteira ${portfolio.name}`}
                        onClick={() => setEditing({ kind: 'edit', item: portfolio })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line px-4 py-3 text-[0.8125rem]">
          <span className="text-ink-2">
            <strong className="font-medium text-ink">Carteiras arquivadas</strong> saem da
            barra lateral; o histórico fica guardado.
          </span>
          <span className="text-ink-3">
            {settings.archived_portfolios.length === 0
              ? 'nenhuma arquivada'
              : `${plural(settings.archived_portfolios.length, 'arquivada', 'arquivadas')} · ${settings.archived_portfolios
                  .map((portfolio) => portfolio.name)
                  .join(', ')}`}
          </span>
        </div>
      </SettingsSection>
      {editing.kind === 'create' || editing.kind === 'edit' ? (
        <PortfolioDialog
          portfolio={editing.kind === 'edit' ? editing.item : null}
          onClose={() => setEditing(NONE)}
          onSaved={done}
          onDelete={
            editing.kind === 'edit'
              ? () => setEditing({ kind: 'delete', item: editing.item })
              : undefined
          }
        />
      ) : null}
      {editing.kind === 'delete' ? (
        <DeletePortfolioDialog
          portfolio={editing.item}
          onClose={() => setEditing(NONE)}
          onDone={done}
        />
      ) : null}
    </>
  );
};

export const AlertsSection = ({
  settings,
}: {
  readonly settings: Settings;
}): React.ReactElement => (
  <SettingsSection
    id="alertas"
    title="Alertas"
    description="Regras que alimentam Requer atenção na Visão geral. Cada alerta aparece marcado com a carteira afetada. Limites marcados “da carteira” valem para a estratégia de cada carteira."
  >
    <table className="w-full text-[0.8125rem]">
      <caption className="sr-only">Regras de alerta</caption>
      <thead>
        <tr>
          <th scope="col" className={TH}>
            Alerta
          </th>
          <th scope="col" className={TH}>
            Limite
          </th>
          <th scope="col" className={TH_RIGHT}>
            Ativo
          </th>
        </tr>
      </thead>
      <tbody>
        {sortAlerts(settings.alerts).map((rule) => {
          const copy = alertCopy(rule.kind);

          return (
            <tr key={rule.kind} className="h-14 border-t border-line">
              <th scope="row" className={`${TD} text-left font-normal`}>
                <span className="block font-medium">{copy.label}</span>
                <span className="block text-ink-3">{copy.description}</span>
              </th>
              <td className={`${TD} tabular`}>{alertLimit(rule)}</td>
              <td className={`${TD} text-right`}>
                <Switch
                  checked={rule.enabled}
                  label={`Regra ${copy.label}`}
                  title="Ligar e desligar regras chega com o motor de alertas (O-01)"
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    <p className="border-t border-line px-4 py-3 text-[0.8125rem] text-ink-3">
      Hoje só as regras de mercado estão cadastradas; as demais chegam com o motor de
      alertas (O-01), junto com o interruptor de cada uma.
    </p>
  </SettingsSection>
);
