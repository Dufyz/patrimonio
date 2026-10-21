import type { MarketHealth } from '@patrimonio/contracts';
import { useEffect, useState } from 'react';

import { refreshMarket } from '../../api/market.js';
import { Button } from '../../components/primitives.js';
import { SkeletonRegion, SkeletonTable } from '../../components/skeleton.js';
import type { Resource } from '../../lib/use_resource.js';
import {
  CATALOG_COMMAND,
  CATALOG_LABEL,
  DEMO_REMOVE_COMMAND,
  SOURCE_STATUS,
  demoSummary,
  hasDemoData,
  orderedCatalogs,
  formatInstant,
  marketSummary,
  plural,
  shortDate,
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
 * A seção responde uma pergunta: o número que está na tela é de hoje? Por isso
 * cada fonte mostra situação, horário da última coleta e cobertura, e a falha
 * vem com a mensagem do erro. A leitura é a de `/market/health` e não faz parte
 * de `/settings`: ela muda sozinha enquanto uma coleta roda, e tem releitura
 * própria depois do "atualizar agora".
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

/**
 * O clique atualiza tudo: cotações, índices, Tesouro, catálogos, cargas e
 * histórico. Ficam de fora só a busca de papéis (`lookup`, que roda quando
 * alguém digita) e o COTAHIST de fechamento, que só roda quando há dia a
 * consolidar.
 */
const isBatchSource = (source: MarketHealth['sources'][number]): boolean =>
  source.kind !== 'lookup' && !(source.kind === 'quotes' && source.source === 'cotahist');

/** O lote da execução; as anteriores à coluna caem no horário em que terminaram. */
const batchOf = (run: MarketHealth['sources'][number]['last_run']): string | null =>
  run === null ? null : (run.batch_at ?? run.finished_at);

const MarketBody = ({
  health,
  refreshing,
  waiting,
  waitingBatch,
  onRefresh,
  onManual,
}: {
  readonly health: MarketHealth;
  readonly refreshing: boolean;
  readonly waiting: boolean;
  /** O lote que a tela espera; as fontes anteriores a ele ainda não rodaram nesta atualização. */
  readonly waitingBatch: number | null;
  readonly onRefresh: () => void;
  readonly onManual: (target: ManualPriceTarget) => void;
}): React.ReactElement => {
  const summary = marketSummary(health);
  const missing = health.missing_prices;
  const shown = missing.slice(0, 3);
  // O lote mais recente entre as fontes: quem ficou para trás aparece em destaque.
  const latestBatch = health.sources.reduce<number | null>((latest, source) => {
    if (!isBatchSource(source)) return latest;
    const batch = batchOf(source.last_run);
    if (batch === null) return latest;
    const time = Date.parse(batch);
    return latest === null || time > latest ? time : latest;
  }, null);

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
        hint={[
          summary.warnings === 0 ? null : plural(summary.warnings, 'aviso', 'avisos'),
          summary.lastLoad === null
            ? null
            : `última carga ${formatInstant(summary.lastLoad)}`,
        ]
          .filter((part) => part !== null)
          .join(' · ')}
        action={
          <Button disabled={refreshing} icon="undo" onClick={onRefresh}>
            {waiting ? 'Atualizando…' : refreshing ? 'Pedindo…' : 'Atualizar agora'}
          </Button>
        }
      >
        <table className="w-full text-[0.8125rem]">
          <caption className="sr-only">Catálogos da carga inicial</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                Catálogo
              </th>
              <th scope="col" className={TH_RIGHT}>
                Registros
              </th>
              <th scope="col" className={TH_RIGHT}>
                Última carga
              </th>
              <th scope="col" className={TH_RIGHT}>
                Situação
              </th>
            </tr>
          </thead>
          <tbody>
            {orderedCatalogs(health.catalogs).map((catalog) => (
              <tr key={catalog.key} className={ROW}>
                <th scope="row" className={`${TD} text-left font-medium`}>
                  {CATALOG_LABEL[catalog.key]}
                </th>
                <td className={`${TD} tabular text-right`}>{catalog.total}</td>
                <td className={`${TD} tabular text-right`}>
                  {formatInstant(catalog.last_loaded)}
                </td>
                <td className={`${TD} text-right`}>
                  {catalog.state === 'pending' ? (
                    <StatusDot tone="attention">
                      pendente · rode{' '}
                      <code className="tabular">{CATALOG_COMMAND[catalog.key]}</code>
                    </StatusDot>
                  ) : (
                    <StatusDot tone="ok">carregado</StatusDot>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsPanel>

      <SettingsPanel>
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
              <th scope="col" className={TH_RIGHT}>
                Última coleta
              </th>
              <th scope="col" className={TH_RIGHT}>
                Cobertura
              </th>
              <th scope="col" className={TH_RIGHT}>
                Cota do mês
              </th>
              <th scope="col" className={TH_RIGHT}>
                Situação
              </th>
            </tr>
          </thead>
          <tbody>
            {health.sources.length === 0 ? (
              <tr className={ROW}>
                <td colSpan={6} className={`${TD} text-ink-3`}>
                  Nenhuma fonte registrou coleta ainda.
                </td>
              </tr>
            ) : (
              health.sources.map((source) => {
                const status = SOURCE_STATUS[source.status];
                const batch = batchOf(source.last_run);
                const reference = waitingBatch ?? latestBatch;
                const behind =
                  isBatchSource(source) &&
                  batch !== null &&
                  reference !== null &&
                  Date.parse(batch) < reference;
                const pending = behind && waitingBatch !== null;

                return (
                  <tr key={`${source.source}:${source.kind}`} className={ROW}>
                    <th scope="row" className={`${TD} text-left font-medium`}>
                      {runKindLabel(source.kind)}
                    </th>
                    <td className={TD}>{sourceLabel(source.source)}</td>
                    <td
                      className={`${TD} tabular text-right ${behind ? 'text-attention' : ''}`}
                      title={
                        [
                          behind && latestBatch !== null
                            ? `Não rodou junto com a última atualização (${formatInstant(new Date(latestBatch).toISOString())})`
                            : null,
                          source.last_run?.ok === false && source.last_success_at
                            ? `Última coleta bem-sucedida: ${formatInstant(source.last_success_at)}`
                            : null,
                        ]
                          .filter((part) => part !== null)
                          .join(' · ') || undefined
                      }
                    >
                      {pending ? 'aguardando…' : formatInstant(batch)}
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
                    <td className={`${TD} text-right`}>
                      <StatusDot tone={status.tone}>
                        {source.status === 'ok' && source.coverage.missing > 0
                          ? source.kind === 'reconcile'
                            ? `${source.coverage.missing} ${source.coverage.missing === 1 ? 'dia' : 'dias'} na fila`
                            : `${source.coverage.missing} sem preço`
                          : status.label}
                      </StatusDot>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
          A hora é a do lote: o instante do clique em “Atualizar agora” (ou do início da
          rotina). Hora em destaque = a fonte não rodou junto com a última atualização.
        </p>

        {health.recent_failures.length === 0 ? null : (
          <ul className="border-t border-line px-4 py-3 text-[0.8125rem]">
            <li className="mb-1 tabular text-label font-medium tracking-[0.06em] text-ink-3 uppercase">
              Falhas recentes
            </li>
            {health.recent_failures.map((run) => (
              <li key={run.id} className="py-0.5">
                <span className="tabular text-negative">
                  {formatInstant(run.finished_at)} · {sourceLabel(run.source)} ·{' '}
                  {runKindLabel(run.kind)}: {run.error ?? 'sem mensagem de erro'}
                </span>
              </li>
            ))}
          </ul>
        )}
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
                  {item.ticker.startsWith('TD-')
                    ? ' · o Tesouro Transparente publica com atraso de dias'
                    : ''}
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
  // O instante do pedido, enquanto a coleta não terminou. A coleta roda no
  // worker, depois de a rota já ter respondido 202: sem reler até ela acabar, a
  // tela mostra o pedido "feito" e as fontes como estavam, que parece um botão
  // que não atualiza nada.
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

    // A atualização termina pela reconciliação, o último passo dela, e todas as
    // execuções carregam o lote do clique: a passada do lote aparecer quer dizer
    // que as demais já foram gravadas.
    const finished = state.value.sources.some(
      (source) =>
        source.kind === 'reconcile' &&
        batchOf(source.last_run) !== null &&
        Date.parse(batchOf(source.last_run) ?? '') >= waiting.batch,
    );

    if (finished) {
      setWaiting(null);
      setNote({ tone: 'ok', text: 'Atualização concluída. Fontes e preços relidos.' });
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
            : 'Atualização pedida. A situação das fontes atualiza quando ela terminar.',
        });
        setWaiting({ since, batch: Date.parse(receipt.requested_at) });
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
      description="Preços e índices chegam por rotinas agendadas; nenhuma tela depende de uma API estar no ar. Se a fonte principal falha, o app usa a alternativa e marca o preço como atrasado. Proventos e eventos não têm fonte: são lançados à mão."
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
          waitingBatch={waiting === null ? null : waiting.batch}
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
