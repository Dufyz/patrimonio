import type { MarketHealth } from '@patrimonio/contracts';
import { useEffect, useState } from 'react';

import { refreshMarket } from '../../api/market.js';
import { Button } from '../../components/primitives.js';
import { SkeletonRegion, SkeletonTable } from '../../components/skeleton.js';
import type { Resource } from '../../lib/use_resource.js';
import {
  DEMO_REMOVE_COMMAND,
  SOURCE_STATUS,
  currentDataRows,
  dataSummary,
  demoSummary,
  formatInstant,
  hasDemoData,
  referenceLoadedAt,
  referencePending,
  referenceSummary,
  shortDate,
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
  SettingsPanel,
  SettingsSection,
  StatusDot,
  TD,
  TH,
  TH_RIGHT,
} from './parts.js';
import { Icon } from '../../components/icon.js';
import { useInRouterContext, Link } from 'react-router';
import { ALL_SCOPE } from '../../lib/scope.js';

/**
 * M-16 · Dados de mercado, em Configurações.
 *
 * A tela responde uma pergunta: os dados de ontem estão aqui? Um cabeçalho diz
 * até que dia os dados vão, uma tabela mostra cada dado do dia (preços, índices,
 * Tesouro) com a última coleta, a cobertura e a mensagem da falha, e uma linha
 * resume os catálogos de referência, que se recarregam sozinhos.
 *
 * "Atualizar agora" é o reset completo: refaz tudo na hora. A coleta roda no
 * worker, depois de a rota já ter respondido 202, então a tela relê até uma
 * coleta posterior ao clique aparecer.
 */

const POLL_MS = 3000;
const WAIT_LIMIT_MS = 10 * 60_000;

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

const PositionsLink = ({ children }: { readonly children: React.ReactNode }) => {
  const to = `/${ALL_SCOPE}/posicoes`;
  const className = 'text-accent hover:underline';
  // Sem roteador (uma pré-visualização isolada) o link vira âncora comum.
  return useInRouterContext() ? (
    <Link to={to} className={className}>
      {children}
    </Link>
  ) : (
    <a href={to} className={className}>
      {children}
    </a>
  );
};

const MarketBody = ({
  health,
  refreshing,
  waiting,
  onRefresh,
  onManual,
}: {
  readonly health: MarketHealth;
  readonly refreshing: boolean;
  readonly waiting: boolean;
  readonly onRefresh: () => void;
  readonly onManual: (target: ManualPriceTarget) => void;
}): React.ReactElement => {
  const summary = dataSummary(health);
  const rows = currentDataRows(health);
  const missing = health.missing_prices;
  const shown = missing.slice(0, 3);
  const loadedAt = referenceLoadedAt(health);

  return (
    <>
      {hasDemoData(health.demo) ? (
        <p
          role="note"
          className="rounded-panel border border-line bg-attention-soft px-4 py-2.5 text-[0.8125rem]"
        >
          <strong className="font-semibold">Dados de demonstração</strong>:{' '}
          {demoSummary(health.demo)}. Para apagá-los sem tocar nos lançamentos reais, rode{' '}
          <code className="tabular">{DEMO_REMOVE_COMMAND}</code>.
        </p>
      ) : null}

      <SettingsPanel
        title={
          <StatusDot tone={summary.tone}>
            <span className="text-ink">{summary.title}</span>
          </StatusDot>
        }
        hint={
          summary.lastLoad === null
            ? undefined
            : `última coleta ${formatInstant(summary.lastLoad)}`
        }
        action={
          <Button disabled={refreshing} icon="undo" onClick={onRefresh}>
            {waiting ? 'Atualizando…' : refreshing ? 'Pedindo…' : 'Atualizar agora'}
          </Button>
        }
      >
        <table className="w-full text-[0.8125rem]">
          <caption className="sr-only">Situação de cada dado do dia</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                Dado
              </th>
              <th scope="col" className={TH}>
                Fonte
              </th>
              <th scope="col" className={TH_RIGHT}>
                Última coleta
              </th>
              <th scope="col" className={TH_RIGHT}>
                Cobertura
              </th>
              <th scope="col" className={TH_RIGHT}>
                Situação
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const source = row.health;
              const run = source?.last_run ?? null;
              const status = source === null ? null : SOURCE_STATUS[source.status];

              return (
                <tr key={row.kind} className={ROW}>
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    {row.label}
                  </th>
                  <td className={TD}>
                    {source === null ? <Muted>—</Muted> : sourceLabel(source.source)}
                  </td>
                  <td className={`${TD} tabular text-right`}>
                    {formatInstant(run?.finished_at ?? null)}
                  </td>
                  <td className={`${TD} tabular text-right`}>
                    {source === null || run === null ? (
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
                  <td className={`${TD} text-right`}>
                    {source === null || status === null ? (
                      <StatusDot tone="neutral">nunca coletou</StatusDot>
                    ) : (
                      <StatusDot tone={status.tone}>
                        {source.status === 'ok' && source.coverage.missing > 0
                          ? `${source.coverage.missing} sem preço`
                          : status.label}
                      </StatusDot>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.some((row) => row.health?.last_run?.ok === false) ? (
          <ul className="border-t border-line px-4 py-3 text-[0.8125rem]">
            {rows.map((row) => {
              const run = row.health?.last_run ?? null;
              if (run === null || run.ok) return null;

              return (
                <li key={row.kind} className="py-0.5">
                  <span className="tabular text-negative">
                    {row.label}: {run.error ?? 'sem mensagem de erro'}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        <p className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-ink-3">
          <span>
            <span className="font-medium text-ink-2">Referência</span> ·{' '}
            {referenceSummary(health)}
            {referencePending(health) ? ' · carregando na próxima atualização' : ''}
          </span>
          <span className="tabular">
            {loadedAt === null ? 'sem carga ainda' : `carga ${formatInstant(loadedAt)}`}
          </span>
        </p>
      </SettingsPanel>

      {missing.length === 0 ? null : (
        <div className="overflow-hidden rounded-panel border border-line bg-panel shadow-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-attention-soft px-4 py-2.5 text-[0.8125rem]">
            <strong className="font-semibold">
              {missing.length === 1
                ? '1 ativo sem cotação do dia'
                : `${missing.length} ativos sem cotação do dia`}
            </strong>
            <span className="text-xs text-ink-3">
              posição de {formatDate(health.reference_date as DateOnly)}
            </span>
          </div>
          <ul>
            {shown.map((item) => (
              <li
                key={item.asset_id}
                className="flex h-(--row-height) items-center gap-3 border-t border-line px-4 text-[0.8125rem] first:border-t-0"
              >
                <Icon name="warning" className="text-attention" />
                <span className="font-semibold">{item.ticker}</span>
                <span className="flex-1 text-xs text-ink-3">
                  {item.last_price_date === null
                    ? 'nunca teve preço'
                    : `último preço de ${shortDate(item.last_price_date)}`}
                </span>
                <button
                  type="button"
                  aria-label={`Definir preço de ${item.ticker}`}
                  className="cursor-pointer text-accent hover:underline"
                  onClick={() =>
                    onManual({
                      asset_id: item.asset_id,
                      ticker: item.ticker,
                      name: item.ticker,
                      price: null,
                      price_date: null,
                    })
                  }
                >
                  Definir preço
                </button>
              </li>
            ))}
          </ul>
          {missing.length > shown.length ? (
            <p className="border-t border-line px-4 py-2.5 text-[0.8125rem]">
              <PositionsLink>
                Ver os outros {missing.length - shown.length} em Posições
              </PositionsLink>
            </p>
          ) : null}
        </div>
      )}
    </>
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
  // O instante do pedido, enquanto a atualização não terminou. Sem reler até
  // uma coleta posterior ao clique aparecer, a tela mostra o pedido "feito" e os
  // dados como estavam, que parece um botão que não atualiza nada.
  const [waiting, setWaiting] = useState<{
    readonly since: number;
    readonly batch: number;
  } | null>(null);

  useEffect(() => {
    if (waiting === null) return undefined;

    const timer = setInterval(() => {
      if (Date.now() - waiting.since > WAIT_LIMIT_MS) {
        setWaiting(null);
        setNote({
          tone: 'error',
          text: 'A atualização não terminou em 10 minutos. Confira se o worker está rodando.',
        });
        return;
      }

      reload();
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [waiting, reload]);

  useEffect(() => {
    if (waiting === null || state.kind !== 'ready') return;

    // Terminou quando um dado do dia registra uma execução posterior ao clique.
    const finished = currentDataRows(state.value).some((row) => {
      const at = row.health?.last_run?.finished_at;
      return at !== undefined && Date.parse(at) >= waiting.batch;
    });

    if (finished) {
      setWaiting(null);
      setNote({ tone: 'ok', text: 'Atualização concluída. Dados relidos.' });
    }
  }, [waiting, state]);

  const refresh = (): void => {
    setRefreshing(true);
    setNote(null);
    const since = Date.now();
    refreshMarket()
      .then((receipt) => {
        setNote({
          tone: 'ok',
          text: receipt.already_queued
            ? 'Já havia uma atualização na fila: o pedido foi somado a ela.'
            : 'Atualização pedida. A tela atualiza quando ela terminar.',
        });
        setWaiting({ since, batch: Date.parse(receipt.requested_at) });
        reload();
      })
      .catch((error: unknown) =>
        setNote({
          tone: 'error',
          text:
            error instanceof Error ? error.message : 'Não foi possível pedir a atualização',
        }),
      )
      .finally(() => setRefreshing(false));
  };

  return (
    <SettingsSection
      id="mercado"
      title="Dados de mercado"
      description="Os dados chegam sozinhos: todo dia útil às 9h e sempre que o app volta a ligar, até o último pregão (D-1). 'Atualizar agora' refaz tudo na hora. Proventos e eventos não têm fonte: são lançados à mão."
    >
      {state.kind === 'loading' ? (
        <SettingsPanel>
          <SkeletonRegion label="Lendo a situação das fontes" className="p-4">
            <SkeletonTable rows={3} columns={4} />
          </SkeletonRegion>
        </SettingsPanel>
      ) : state.kind === 'error' ? (
        <SettingsPanel>
          <Failed error={state.error} onRetry={reload} />
        </SettingsPanel>
      ) : (
        <MarketBody
          health={state.value}
          refreshing={refreshing || waiting !== null}
          waiting={waiting !== null}
          onRefresh={refresh}
          onManual={setManual}
        />
      )}
      <ManualPriceDialog
        position={manual}
        defaultDate={
          resource.state.kind === 'ready' ? resource.state.value.reference_date : ''
        }
        onClose={() => setManual(null)}
        onSaved={() => {
          setManual(null);
          reload();
        }}
      />
      {note === null ? null : (
        <ActionNote tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</ActionNote>
      )}
    </SettingsSection>
  );
};
