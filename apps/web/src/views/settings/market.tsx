import type { MarketHealth } from '@patrimonio/contracts';
import { useEffect, useState } from 'react';

import { refreshMarket } from '../../api/market.js';
import { AlertModal } from '../../components/overlay.js';
import { usePreferences } from '../../components/preferences.js';
import { formatMoney } from '../../lib/format.js';
import { PanelFailed } from '../../components/panel_state.js';
import { Button } from '../../components/primitives.js';
import { SkeletonRegion, SkeletonTable } from '../../components/skeleton.js';
import type { Resource } from '../../lib/use_resource.js';
import {
  DEMO_REMOVE_COMMAND,
  SOURCE_STATUS,
  currentDataRows,
  marketSummary,
  demoSummary,
  formatInstant,
  hasDemoData,
  plural,
  referenceLoadedAt,
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
  PanelFootnote,
  ROW,
  SettingsPanel,
  SettingsSection,
  StatusDot,
  TD,
  TH,
  TH_RIGHT,
} from './parts.js';

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
  <PanelFailed error={error} onRetry={onRetry} what="a situação das fontes" />
);

const CATALOG_LABEL: Readonly<Record<MarketHealth['catalogs'][number]['key'], string>> = {
  institutions: 'Instituições',
  instruments: 'Instrumentos listados',
  treasury: 'Tesouro Direto',
  indices: 'Índices',
  price_history: 'Histórico de preços',
};

/** O nome do dado que cada tipo de coleta traz, como na prancha. */
const RUN_LABEL: Readonly<Record<MarketHealth['sources'][number]['kind'], string>> = {
  quotes: 'Cotações',
  lookup: 'Lookup',
  cotahist: 'Carga inicial',
  indices: 'Índices',
  treasury: 'Tesouro Direto',
  backfill: 'Histórico de ativo',
  contract_check: 'Verificação de contrato',
};

const RUN_ORDER = Object.keys(RUN_LABEL);

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
  const { hidden } = usePreferences();
  const warnings = marketSummary(health).warnings;
  const sources = health.sources
    .filter((source) => source.kind !== 'contract_check')
    .sort((a, b) => RUN_ORDER.indexOf(a.kind) - RUN_ORDER.indexOf(b.kind));
  const missing = health.missing_prices;
  const loadedAt = referenceLoadedAt(health);
  const failure = health.recent_failures[0];

  return (
    <>
      {hasDemoData(health.demo) ? (
        <p
          role="note"
          className="rounded-panel border border-line bg-attention-soft px-4 py-2.5 text-[0.8125rem]"
        >
          <strong className="font-semibold">Dados de demonstração</strong>:{' '}
          {demoSummary(health.demo)}. Para apagá-los sem tocar nas movimentações reais,
          rode <code className="tabular">{DEMO_REMOVE_COMMAND}</code>.
        </p>
      ) : null}

      <SettingsPanel
        title="Catálogos"
        hint={`${
          warnings === 0 ? 'sem avisos' : plural(warnings, 'aviso', 'avisos')
        } · ${loadedAt === null ? 'sem carga ainda' : `última carga ${formatInstant(loadedAt)}`}`}
        action={
          <Button disabled={refreshing} onClick={onRefresh}>
            {waiting ? 'Atualizando…' : refreshing ? 'Pedindo…' : 'Atualizar agora'}
          </Button>
        }
      >
        <table className="w-full text-[0.8125rem]">
          <caption className="sr-only">Catálogos de referência</caption>
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
              <th scope="col" className={TH}>
                Situação
              </th>
            </tr>
          </thead>
          <tbody>
            {health.catalogs.map((catalog) => (
              <tr key={catalog.key} className={ROW}>
                <th scope="row" className={`${TD} text-left font-medium`}>
                  {CATALOG_LABEL[catalog.key]}
                </th>
                <td className={`${TD} tabular text-right`}>{catalog.total}</td>
                <td className={`${TD} tabular text-right`}>
                  {formatInstant(catalog.last_loaded)}
                </td>
                <td className={TD}>
                  <StatusDot tone={catalog.state === 'loaded' ? 'ok' : 'attention'}>
                    {catalog.state === 'loaded' ? 'carregado' : 'pendente'}
                  </StatusDot>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <PanelFootnote>
          Preços e índices chegam por rotinas agendadas; se a fonte principal falha, o app
          usa a alternativa e marca o preço como atrasado. Proventos e eventos são
          lançados à mão.
        </PanelFootnote>
      </SettingsPanel>

      <SettingsPanel title="Fontes" hint="cota do mês e situação">
        <table className="w-full text-[0.8125rem]">
          <caption className="sr-only">Situação de cada fonte</caption>
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
              <th scope="col" className={`${TH_RIGHT} max-md:hidden`}>
                Cota do mês
              </th>
              <th scope="col" className={TH}>
                Situação
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => {
              const status = SOURCE_STATUS[source.status];
              return (
                <tr key={`${source.kind}-${source.source}`} className={ROW}>
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    {RUN_LABEL[source.kind]}
                  </th>
                  <td className={`${TD} text-ink-2`}>{sourceLabel(source.source)}</td>
                  <td className={`${TD} tabular text-right`}>
                    {formatInstant(source.last_run?.finished_at ?? null)}
                  </td>
                  <td className={`${TD} tabular text-right max-md:hidden`}>
                    {source.budget === null ? (
                      <Muted>—</Muted>
                    ) : (
                      `${source.budget.used} / ${source.budget.ceiling}`
                    )}
                  </td>
                  <td className={TD}>
                    <StatusDot
                      tone={
                        source.status === 'ok' && source.coverage.missing > 0
                          ? 'attention'
                          : status.tone
                      }
                    >
                      {source.status === 'ok' && source.coverage.missing > 0
                        ? `${source.coverage.missing} sem preço`
                        : status.label}
                    </StatusDot>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {failure === undefined ? null : (
          <PanelFootnote>
            Falha recente: {formatInstant(failure.finished_at)} ·{' '}
            {RUN_LABEL[failure.kind].toLowerCase()} · {sourceLabel(failure.source)}:{' '}
            {failure.error ?? 'sem mensagem de erro'}
          </PanelFootnote>
        )}
      </SettingsPanel>

      {missing.length === 0 ? null : (
        <SettingsPanel
          title={
            missing.length === 1
              ? '1 ativo sem cotação do dia'
              : `${missing.length} ativos sem cotação do dia`
          }
          hint={`posição de ${formatDate(health.reference_date as DateOnly)}`}
        >
          <ul>
            {missing.map((item) => (
              <li
                key={item.asset_id}
                className="grid h-(--row-height) grid-cols-[1fr_1fr_auto_auto] items-center gap-4 border-t border-line px-4 text-[0.8125rem] first:border-t-0"
              >
                <span className="font-semibold">{item.ticker}</span>
                <span className="text-ink-3">
                  {item.last_price_date === null
                    ? 'nunca teve preço'
                    : `último preço de ${shortDate(item.last_price_date)}`}
                </span>
                <span className="tabular text-right">
                  {item.last_price === null
                    ? ''
                    : formatMoney(item.last_price, { hidden }).text}
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
        </SettingsPanel>
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

  const [confirming, setConfirming] = useState(false);

  const refresh = (): void => {
    setConfirming(false);
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
            error instanceof Error
              ? error.message
              : 'Não foi possível pedir a atualização',
        }),
      )
      .finally(() => setRefreshing(false));
  };

  return (
    <SettingsSection
      id="dados-de-mercado"
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
          onRefresh={() => setConfirming(true)}
          onManual={setManual}
        />
      )}
      <AlertModal
        icon="repeat"
        open={confirming}
        title="Atualizar tudo agora?"
        message="Recoletar o histórico pode demorar alguns minutos. Pode repetir sem medo: pedidos repetidos se somam ao que já está na fila."
        cancelLabel="Cancelar"
        confirmLabel="Atualizar agora"
        danger={false}
        onCancel={() => setConfirming(false)}
        onConfirm={refresh}
      />
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
