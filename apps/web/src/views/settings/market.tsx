import type { MarketHealth } from '@patrimonio/contracts';
import { useState } from 'react';

import { refreshMarket } from '../../api/market.js';
import { Button } from '../../components/primitives.js';
import type { Resource } from '../../lib/use_resource.js';
import {
  SOURCE_STATUS,
  formatInstant,
  missingPricesText,
  runKindLabel,
  sourceLabel,
} from '../../lib/settings.js';
import { formatDate } from '../../lib/overview.js';
import type { DateOnly } from '@patrimonio/domain';
import type { ManualPriceTarget } from '../manual_price_dialog.js';
import { ManualPriceDialog } from '../manual_price_dialog.js';
import {
  ActionNote,
  Muted,
  ROW,
  SettingsSection,
  StatusDot,
  TD,
  TH,
  TH_RIGHT,
} from './parts.js';

/**
 * M-16 · Dados de mercado, em Configurações.
 *
 * A seção responde uma pergunta: o número que está na tela é de hoje? Por isso
 * cada fonte mostra situação, horário da última coleta e cobertura, e a falha
 * vem com a mensagem do erro. A leitura é a de `/market/health` e não faz parte
 * de `/settings`: ela muda sozinha enquanto uma coleta roda, e tem releitura
 * própria depois do "atualizar agora".
 */

const Failed = ({
  error,
  onRetry,
}: {
  readonly error: Error;
  readonly onRetry: () => void;
}): React.ReactElement => (
  <div role="alert" className="flex flex-wrap items-center gap-3 p-4 text-[0.8125rem]">
    <span className="text-negative">
      Não foi possível ler a situação das fontes: {error.message}
    </span>
    <Button onClick={onRetry}>Tentar de novo</Button>
  </div>
);

const budgetText = (
  budget: MarketHealth['sources'][number]['budget'],
): React.ReactElement => {
  if (budget === null) return <Muted>—</Muted>;

  return (
    <span
      className={
        budget.exceeded ? 'text-negative' : budget.warning ? 'text-attention' : ''
      }
      title={`${budget.remaining} requisições restantes no mês`}
    >
      {budget.used} / {budget.ceiling}
    </span>
  );
};

export const MarketSection = ({
  resource,
}: {
  readonly resource: Resource<MarketHealth>;
}): React.ReactElement => {
  const { state, reload } = resource;
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [manual, setManual] = useState<ManualPriceTarget | null>(null);

  const refresh = (): void => {
    setRefreshing(true);
    setNote(null);
    refreshMarket()
      .then((receipt) => {
        setNote({
          tone: 'ok',
          text: receipt.already_queued
            ? 'Já havia uma coleta na fila: o pedido foi somado a ela.'
            : 'Coleta pedida. A situação das fontes atualiza quando ela terminar.',
        });
        reload();
      })
      .catch((error: unknown) =>
        setNote({
          tone: 'error',
          text:
            error instanceof Error ? error.message : 'Não foi possível pedir a coleta',
        }),
      )
      .finally(() => setRefreshing(false));
  };

  return (
    <SettingsSection
      id="mercado"
      title="Dados de mercado"
      description="Preços e índices são baixados para o app por rotinas agendadas; nenhuma tela depende de uma API estar no ar. Quando a fonte principal falha, o app usa a alternativa e marca o preço como atrasado até a fonte voltar ou você definir um preço manual."
      action={
        <Button disabled={refreshing} onClick={refresh}>
          <span aria-hidden="true">↻</span> {refreshing ? 'Pedindo…' : 'Atualizar agora'}
        </Button>
      }
    >
      {state.kind === 'loading' ? (
        <p aria-busy="true" className="p-4 text-[0.8125rem] text-ink-3">
          Lendo a situação das fontes…
        </p>
      ) : state.kind === 'error' ? (
        <Failed error={state.error} onRetry={reload} />
      ) : (
        <>
          <table className="w-full text-[0.8125rem]">
            <caption className="sr-only">Situação de cada fonte de dados</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  Dado
                </th>
                <th scope="col" className={TH}>
                  Fonte
                </th>
                <th scope="col" className={TH}>
                  Última coleta
                </th>
                <th scope="col" className={TH_RIGHT}>
                  Cobertura
                </th>
                <th scope="col" className={TH_RIGHT}>
                  Cota do mês
                </th>
                <th scope="col" className={TH}>
                  Situação
                </th>
              </tr>
            </thead>
            <tbody>
              {state.value.sources.length === 0 ? (
                <tr className={ROW}>
                  <td colSpan={6} className={`${TD} text-ink-3`}>
                    Nenhuma fonte registrou coleta ainda.
                  </td>
                </tr>
              ) : (
                state.value.sources.map((source) => {
                  const status = SOURCE_STATUS[source.status];

                  return (
                    <tr key={`${source.source}:${source.kind}`} className={ROW}>
                      <th scope="row" className={`${TD} text-left font-medium`}>
                        {runKindLabel(source.kind)}
                      </th>
                      <td className={TD}>{sourceLabel(source.source)}</td>
                      <td className={`${TD} tabular`}>
                        {formatInstant(source.last_run?.finished_at ?? null)}
                      </td>
                      <td className={`${TD} tabular text-right`}>
                        {source.last_run === null ? (
                          <Muted>—</Muted>
                        ) : source.coverage.missing > 0 ? (
                          <span className="text-attention">
                            {source.coverage.items - source.coverage.missing} /{' '}
                            {source.coverage.items}
                          </span>
                        ) : (
                          source.coverage.items
                        )}
                      </td>
                      <td className={`${TD} tabular text-right`}>
                        {budgetText(source.budget)}
                      </td>
                      <td className={TD}>
                        <StatusDot tone={status.tone}>
                          {source.status === 'ok' && source.coverage.missing > 0
                            ? `${source.coverage.missing} sem preço`
                            : status.label}
                        </StatusDot>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {state.value.recent_failures.length === 0 ? null : (
            <ul className="border-t border-line px-4 py-3 text-[0.8125rem]">
              <li className="mb-1 text-label tracking-wide text-ink-3 uppercase">
                Falhas recentes
              </li>
              {state.value.recent_failures.map((run) => (
                <li key={run.id} className="py-0.5">
                  <span className="tabular text-ink-3">
                    {formatInstant(run.finished_at)} · {sourceLabel(run.source)} ·{' '}
                    {runKindLabel(run.kind)}:
                  </span>{' '}
                  <span className="text-negative">
                    {run.error ?? 'sem mensagem de erro'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {state.value.missing_prices.length === 0 ? null : (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-attention-soft px-4 py-3 text-[0.8125rem]">
              <span className="text-attention">
                <span aria-hidden="true">⚠ </span>
                {missingPricesText(state.value.missing_prices)}
                {' · '}
                posição de {formatDate(state.value.reference_date as DateOnly)}
              </span>
              <span className="flex flex-wrap gap-2">
                {state.value.missing_prices.slice(0, 6).map((item) => (
                  <Button
                    key={item.asset_id}
                    onClick={() =>
                      setManual({
                        asset_id: item.asset_id,
                        ticker: item.ticker,
                        name: item.ticker,
                        price: null,
                        price_date: null,
                      })
                    }
                  >
                    Definir preço de {item.ticker}
                  </Button>
                ))}
              </span>
            </div>
          )}

          <ManualPriceDialog
            position={manual}
            defaultDate={state.value.reference_date}
            onClose={() => setManual(null)}
            onSaved={() => {
              setManual(null);
              reload();
            }}
          />
        </>
      )}
      {note === null ? null : (
        <div className="border-t border-line px-4 py-3">
          <ActionNote tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</ActionNote>
        </div>
      )}
    </SettingsSection>
  );
};
