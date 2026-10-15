import type { AssetPageResource } from '@patrimonio/contracts';
import type { TransactionKind } from '@patrimonio/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchAssetPage } from '../api/asset_page.js';
import { ApiError } from '../api/client.js';
import { MonthlyBarsChart } from '../components/monthly_bars_chart.js';
import type { MonthlyBar } from '../components/monthly_bars_chart.js';
import {
  Money,
  MoneyChange,
  Percent,
  PercentChange,
  Quantity,
} from '../components/number.js';
import { ConfirmDialog, Menu } from '../components/overlay.js';
import { useEntry } from '../components/entry_provider.js';
import type { OpenEntryRequest } from '../components/entry_provider.js';
import { KeepPrevious } from '../components/pending.js';
import {
  SkeletonChart,
  SkeletonHeader,
  SkeletonPanel,
  SkeletonRegion,
  SkeletonStats,
  SkeletonTable,
} from '../components/skeleton.js';
import { usePreferences } from '../components/preferences.js';
import {
  Button,
  Chip,
  IconButton,
  Label,
  Panel,
  PriceHealthDot,
  Segmented,
} from '../components/primitives.js';
import { SeriesChart } from '../components/series_chart.js';
import { CONTRIBUTIONS_COLOR, growthBands, resultColor } from '../lib/overview.js';
import type { ChartMarker } from '../components/series_chart.js';
import {
  DEFAULT_ASSET_PERIOD,
  PAYOUT_KIND_LABELS,
  PAYOUT_SLICES,
  PERIOD_OPTIONS,
  PERIOD_PARAM,
  TRANSACTION_KIND_LABELS,
  assetState,
  assetTitle,
  hasQuantityAndPrice,
  isPeriodParam,
  kindOptions,
  monthInitial,
  priceStamp,
  transactionsCountLabel,
  usedPayoutSlices,
  usesValueChart,
  fixedIncomeFacts,
} from '../lib/asset_page.js';
import type { PeriodParam } from '../lib/asset_page.js';
import { compareDecimal } from '../lib/decimal.js';
import { duplicateRequest } from '../lib/entry.js';
import { formatFullDate, formatShortDate } from '../lib/positions.js';
import { SEMANTIC_COLORS, colorForSeries, colorForToken } from '../lib/tokens.js';
import { deleteTransaction, undoDeletion } from '../api/transactions.js';
import { ManualPriceDialog } from './manual_price_dialog.js';
import { CaixinhaPanel } from './caixinha_panel.js';
import { CustodyHistory } from './custody_history.js';
import { CustodyTransferDialog } from './custody_transfer_dialog.js';
import {
  ArchiveAssetDialog,
  AssetDialog,
  DeleteAssetDialog,
} from './registers/asset_dialogs.js';
import type { ManualPriceTarget } from './manual_price_dialog.js';
import { Icon } from '../components/icon.js';

/**
 * T-03 · A página do ativo.
 *
 * Tudo sobre um papel em um lugar, para responder uma pergunta de decisão:
 * vale manter, aumentar ou sair. A prancha 06 organiza a resposta em duas
 * alturas — em cima o que é imediato (quanto tenho, quanto vale, como o preço
 * andou), embaixo o que é contexto (de onde vem a renda, o que já foi lançado,
 * o que o papel é) —, e o arquivo segue essa ordem.
 *
 * Nenhum número desta tela é calculado aqui, pela razão de T-02: subtotal,
 * peso, resultado, yield e retorno chegam prontos da `api`. O que acontece
 * neste arquivo é escolher onde cada um aparece.
 */

export type AssetScreenProps = {
  /** Código ou identificador: o endereço aceita os dois. */
  readonly assetRef: string;
  readonly portfolioId: string;
  readonly scopeLabel: string;
  readonly onBack: () => void;
  /** Abre Movimentações filtrada por este ativo, em todo o período. */
  readonly onOpenStatement?: ((search: string) => void) | undefined;
};

export const AssetScreen = ({
  assetRef,
  portfolioId,
  scopeLabel,
  onBack,
  onOpenStatement,
}: AssetScreenProps): React.ReactElement => {
  const [params, setParams] = useSearchParams();
  const { hidden: valuesHidden, toggleHidden } = usePreferences();

  const rawPeriod = params.get('janela');
  const period = isPeriodParam(rawPeriod) ? rawPeriod : DEFAULT_ASSET_PERIOD;
  const kind = params.get('tipo') as TransactionKind | null;

  const [resource, setResource] = useState<AssetPageResource | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [manualPriceOpen, setManualPriceOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [dialog, setDialog] = useState<'edit' | 'delete' | 'archive' | null>(null);
  const [reloads, setReloads] = useState(0);
  const entry = useEntry();

  // O padrão nunca é escrito na URL: `/ativo/itub4` é a janela de um ano sem
  // filtro de tipo, e não `/ativo/itub4?janela=1a&tipo=`.
  const update = useCallback(
    (changes: Readonly<Record<string, string | null>>): void => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        return next;
      });
    },
    [setParams],
  );

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);

    fetchAssetPage(
      { assetId: assetRef, portfolioId, period: PERIOD_PARAM[period], kind },
      controller.signal,
    )
      .then((next) => {
        setResource(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setResource(null);
        setError({
          message: cause instanceof Error ? cause.message : 'A api não respondeu',
          status: cause instanceof ApiError ? cause.status : 0,
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });

    return () => controller.abort();
  }, [assetRef, portfolioId, period, kind, reloads, entry.version]);

  if (error !== null) {
    return <AssetError assetRef={assetRef} error={error} onBack={onBack} />;
  }

  if (resource === null) {
    return pending ? (
      <SkeletonRegion label="Carregando o ativo" className="flex flex-col gap-4">
        <SkeletonHeader />
        <SkeletonStats count={5} />
        <SkeletonPanel>
          <SkeletonChart />
        </SkeletonPanel>
        <SkeletonPanel title="Lançamentos">
          <SkeletonTable rows={5} columns={5} />
        </SkeletonPanel>
      </SkeletonRegion>
    ) : (
      <p className="px-1 py-10 text-sm text-ink-3">Nada a mostrar.</p>
    );
  }

  const title = assetTitle(resource.asset);
  const state = assetState(resource);
  const stamp = priceStamp(resource);

  /** O modal abre já neste ativo, na carteira do escopo (ou na primeira). */
  const entryFor = (tab: OpenEntryRequest['tab']): OpenEntryRequest => ({
    ...(tab === undefined ? {} : { tab }),
    asset: {
      id: resource.asset.asset_id,
      label: title,
      name: resource.asset.name,
      held: resource.position?.quantity ?? null,
    },
    portfolioId,
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1.5">
          {/* O nome de um título pode ter cinquenta caracteres: ele quebra em
              até duas linhas dentro da coluna, e não empurra o resto da tela. */}
          <h1
            className={`line-clamp-2 font-semibold [overflow-wrap:anywhere] ${
              title.length > 16
                ? 'text-[1.25rem] leading-7'
                : 'tabular text-[1.625rem] leading-8'
            }`}
            title={title}
          >
            {title}
          </h1>
          {resource.asset.name === title ? null : (
            <p className="truncate text-sm text-ink-2" title={resource.asset.name}>
              {resource.asset.name}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5">
            {resource.asset.category_name === null ? null : (
              <Chip colorToken={resource.asset.color_token ?? undefined}>
                {resource.asset.category_name}
              </Chip>
            )}
            {resource.asset.sector === null ? null : <Chip>{resource.asset.sector}</Chip>}
            {resource.custodians.map((custodian) => (
              <Chip key={custodian.institution_id}>{custodian.institution_name}</Chip>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col items-end gap-2">
          <div className="flex flex-col items-end">
            <span className="tabular text-[1.5rem] leading-7 font-semibold">
              {resource.price.value !== null ? (
                <Money value={resource.price.value} />
              ) : resource.position !== null && usesValueChart(resource) ? (
                <Money value={resource.position.value} />
              ) : (
                <span className="text-ink-3">—</span>
              )}
            </span>
            <span className="flex items-center gap-1.5 text-[0.75rem] text-ink-3">
              {resource.price.value === null &&
              resource.position !== null &&
              usesValueChart(resource) ? (
                <span>valor na curva</span>
              ) : null}
              {resource.price.day_change_ratio === null ? null : (
                <>
                  <PercentChange value={resource.price.day_change_ratio} />
                  <span>hoje</span>
                </>
              )}
              {stamp === null ? null : (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1">
                    {resource.price.price_health === null ? null : (
                      <PriceHealthDot kind={resource.price.price_health} />
                    )}
                    {stamp}
                  </span>
                </>
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <IconButton
              label={valuesHidden ? 'Mostrar valores' : 'Ocultar valores'}
              aria-pressed={valuesHidden}
              onClick={toggleHidden}
            >
              <Icon name={valuesHidden ? 'eye-off' : 'eye'} />
            </IconButton>

            <Button icon="pencil" onClick={() => setDialog('edit')}>
              Editar ativo
            </Button>

            <Menu
              variant="button"
              label={`Ações de ${title}`}
              items={[
                {
                  id: 'manual_price',
                  label: 'Definir preço manual',
                  icon: <Icon name="tag" />,
                  onSelect: () => setManualPriceOpen(true),
                },
                {
                  id: 'transfer_custody',
                  label: 'Transferir custódia',
                  hint: resource.position === null ? 'sem posição aberta' : undefined,
                  icon: <Icon name="swap" />,
                  disabled: resource.position === null,
                  onSelect: () => setTransferOpen(true),
                },
                {
                  id: 'transactions',
                  label: 'Ver todos os lançamentos',
                  icon: <Icon name="swap" />,
                  disabled: onOpenStatement === undefined,
                  onSelect: () => onOpenStatement?.(title),
                },
                {
                  id: 'archive',
                  label: 'Arquivar ativo',
                  hint: 'zere a posição antes',
                  icon: <Icon name="archive" />,
                  disabled: resource.asset.archived_at !== null,
                  onSelect: () => setDialog('archive'),
                },
                {
                  id: 'delete',
                  label: 'Excluir ativo',
                  icon: <Icon name="trash" />,
                  destructive: true,
                  onSelect: () => setDialog('delete'),
                },
              ]}
            />

            <Button
              variant="primary"
              shortcut="L"
              onClick={() => entry.openEntry(entryFor('buy'))}
            >
              Lançar
            </Button>
          </div>
        </div>
      </header>

      <KeepPrevious pending={pending}>
        <div className="flex flex-col gap-4">
          {/* A faixa de cima: o que é imediato. Os dois blocos dividem a mesma
              moldura, como a prancha desenha — a posição à esquerda não é um
              painel separado do gráfico, é a legenda dele. */}
          <section className="flex flex-wrap items-stretch rounded-panel border border-line bg-panel">
            <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1 p-5 md:max-w-[21rem]">
              <Label className="mb-2">Sua posição · {scopeLabel}</Label>
              {/* A lista cresce com o tipo do ativo; rolar aqui evita esticar o
                  cartão e deformar o gráfico ao lado. */}
              <div className="-mr-2 min-h-0 overflow-y-auto pr-2 md:max-h-[17.5rem]">
                <PositionFacts resource={resource} state={state} />
              </div>
            </div>

            <div className="flex min-w-0 flex-[3_1_32rem] flex-col gap-3 border-line p-5 md:border-l">
              {usesValueChart(resource) ? (
                <YieldChart
                  resource={resource}
                  period={period}
                  onPeriod={(value) =>
                    update({ janela: value === DEFAULT_ASSET_PERIOD ? null : value })
                  }
                />
              ) : (
                <PriceChart
                  resource={resource}
                  period={period}
                  onPeriod={(value) =>
                    update({ janela: value === DEFAULT_ASSET_PERIOD ? null : value })
                  }
                />
              )}
            </div>
          </section>

          {resource.asset.redemption_rule === null ? null : (
            <CaixinhaPanel
              portfolioId={portfolioId}
              asset={resource.asset}
              reloadKey={reloads}
              onChanged={() => setReloads((count) => count + 1)}
            />
          )}

          <EvolutionPanel resource={resource} />

          {/* A faixa de baixo: o contexto, uma linha por bloco. Cada um usa a
              largura inteira: a grade de doze meses e a tabela do histórico
              precisam dela, e três colunas estreitas cortavam o valor. */}
          <HistoryPanel
            resource={resource}
            kind={kind}
            onKind={(value) => update({ tipo: value })}
            onChanged={() => setReloads((count) => count + 1)}
          />
          {hasRegisteredPayouts(resource) ? <PayoutsPanel resource={resource} /> : null}
          <CustodyHistory
            portfolioId={portfolioId}
            assetId={resource.asset.asset_id}
            transfers={resource.custody_transfers}
            onChanged={() => setReloads((count) => count + 1)}
          />
        </div>
      </KeepPrevious>

      {dialog === 'edit' ? (
        <AssetDialog
          asset={resource.asset}
          onClose={() => setDialog(null)}
          onSaved={(ticker) => {
            setDialog(null);
            // O endereço do ativo é o código dele: com o código novo, o
            // endereço antigo deixa de existir, e a trilha volta para Posições.
            if (ticker.toLowerCase() !== resource.asset.ticker.toLowerCase()) onBack();
            else setReloads((count) => count + 1);
          }}
          onDelete={() => setDialog('delete')}
          onArchive={() => setDialog('archive')}
        />
      ) : null}
      {dialog === 'delete' ? (
        <DeleteAssetDialog
          asset={resource.asset}
          onClose={() => setDialog(null)}
          onDone={onBack}
          onOpenStatement={() => {
            setDialog(null);
            onOpenStatement?.(title);
          }}
        />
      ) : null}
      {dialog === 'archive' ? (
        <ArchiveAssetDialog
          asset={resource.asset}
          onClose={() => setDialog(null)}
          onDone={onBack}
        />
      ) : null}

      {transferOpen ? (
        <CustodyTransferDialog
          target={{
            portfolio_id: portfolioId,
            asset_id: resource.asset.asset_id,
            ticker: resource.asset.ticker,
            name: resource.asset.name,
            institution_id: resource.custodians[0]?.institution_id ?? null,
            institution_name: resource.custodians[0]?.institution_name ?? null,
          }}
          onClose={() => setTransferOpen(false)}
          onSaved={() => {
            setTransferOpen(false);
            setReloads((count) => count + 1);
          }}
        />
      ) : null}

      <ManualPriceDialog
        position={manualPriceOpen ? asManualPriceTarget(resource) : null}
        defaultDate={resource.as_of}
        onClose={() => setManualPriceOpen(false)}
        onSaved={() => {
          setManualPriceOpen(false);
          setReloads((count) => count + 1);
        }}
      />
    </div>
  );
};

/* -------------------------------------------------------------------------- */

/**
 * O diálogo de preço manual é o de Posições, e recebe as cinco colunas que ele
 * lê. Reusá-lo é deliberado: o preview do efeito vem da `api` nos dois lugares,
 * e uma segunda cópia do formulário seria uma segunda chance de divergirem.
 */
const asManualPriceTarget = (resource: AssetPageResource): ManualPriceTarget => ({
  asset_id: resource.asset.asset_id,
  ticker: resource.asset.ticker,
  name: resource.asset.name,
  price: resource.price.value,
  price_date: resource.price.price_date,
});

/* -------------------------------------------------------------------------- */

/**
 * As oito linhas da esquerda. Posição zerada não mostra zeros: diz que está
 * zerada e, se o papel já teve lançamentos, mostra o que ele rendeu na vida —
 * é o que permite abrir um papel vendido e ainda ver a conta dele.
 */
const PositionFacts = ({
  resource,
  state,
}: {
  readonly resource: AssetPageResource;
  readonly state: ReturnType<typeof assetState>;
}): React.ReactElement => {
  const { lifetime } = resource;
  const type = b3TypeLabel(resource.asset.b3_type);

  if (resource.position === null) {
    const traded = lifetime.buys + lifetime.sells > 0;

    return (
      <>
        <p className="py-2 text-[0.8125rem] text-ink-3">
          {state === 'never_closed'
            ? 'Carteira ainda não consolidada: a posição aparece depois da primeira consolidação.'
            : 'Posição zerada. O que o papel rendeu na carteira está abaixo.'}
        </p>
        {traded ? (
          <dl className="flex flex-col">
            <Row label="Valor investido">
              <Money value={lifetime.invested} />
            </Row>
            <Row label="Valor vendido">
              <Money value={lifetime.proceeds} />
            </Row>
            {lifetime.realized_result === null ? null : (
              <Row label="Resultado realizado">
                <MoneyChange value={lifetime.realized_result} />
              </Row>
            )}
            <Row label="Proventos recebidos">
              <Money value={lifetime.payouts_received} />
            </Row>
            <Row label="Rentabilidade (TWR)">
              <PercentChange value={lifetime.twr_ratio} decimals={1} />
            </Row>
            <Row label="Rentabilidade (TIR)">
              <PercentChange value={lifetime.xirr_ratio} decimals={1} />
            </Row>
            {lifetime.first_trade_date === null ||
            lifetime.last_trade_date === null ? null : (
              <Row label="Período">
                <span className="tabular">
                  {formatShortDate(lifetime.first_trade_date)} →{' '}
                  {formatShortDate(lifetime.last_trade_date)}
                </span>
              </Row>
            )}
            <Row label="Tipo do ativo">{type}</Row>
          </dl>
        ) : null}
      </>
    );
  }

  const position = resource.position;

  // Título na curva: quantidade e preço médio não dizem nada. O que se lê é
  // quanto foi aplicado, quanto vale e o que a curva já rendeu, seguido das
  // condições do papel.
  if (resource.asset.indexer !== null) {
    return (
      <dl className="flex flex-col">
        <Row label="Valor investido">
          <Money value={position.cost_basis} />
        </Row>
        <Row label="Valor atualizado">
          <Money value={position.value} />
        </Row>
        <Row label="Rendimento bruto">
          <MoneyChange value={position.open_result} />
        </Row>
        <Row label="Rentabilidade">
          <PercentChange value={position.open_result_ratio} decimals={2} />
        </Row>
        <Row label="Rentabilidade (TIR)">
          <PercentChange value={lifetime.xirr_ratio} decimals={1} />
        </Row>
        <Row label="Peso na carteira">
          <Percent value={position.weight} decimals={1} />
        </Row>
        {fixedIncomeFacts(resource.asset).map((fact) => (
          <Row key={fact.label} label={fact.label}>
            <span className="text-right">{fact.value}</span>
          </Row>
        ))}
      </dl>
    );
  }

  return (
    <dl className="flex flex-col">
      <Row label="Quantidade">
        <Quantity value={position.quantity} />
      </Row>
      <Row label="Preço médio">
        <Money value={position.avg_price} />
      </Row>
      <Row label="Valor investido">
        <Money value={position.cost_basis} />
      </Row>
      <Row label="Valor atualizado">
        <Money value={position.value} />
      </Row>
      <Row label="Rentabilidade (TWR)">
        <PercentChange value={lifetime.twr_ratio} decimals={1} />
      </Row>
      <Row label="Rentabilidade (TIR)">
        <PercentChange value={lifetime.xirr_ratio} decimals={1} />
      </Row>
      <Row label="Peso na carteira">
        <Percent value={position.weight} decimals={1} />
      </Row>
      <Row label="Tipo do ativo">{type}</Row>
    </dl>
  );
};

const Row = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <div className="flex items-baseline justify-between gap-3 border-t border-line py-2.5 text-[0.8125rem]">
    <dt className="text-ink-2">{label}</dt>
    <dd className="font-medium">{children}</dd>
  </div>
);

/* -------------------------------------------------------------------------- */

/**
 * O gráfico de preço, com as compras e as vendas de quem olha marcadas sobre a
 * linha e o preço médio como referência horizontal.
 *
 * A série é a **ajustada por evento** (M-15): sem o ajuste, um desdobramento
 * 1:2 apareceria como uma queda de 50% que não aconteceu — e as marcas de
 * compra, que estão em preço negociado, ficariam no lugar errado da escala.
 */
const PriceChart = ({
  resource,
  period,
  onPeriod,
}: {
  readonly resource: AssetPageResource;
  readonly period: PeriodParam;
  readonly onPeriod: (value: PeriodParam) => void;
}): React.ReactElement => {
  const { points, marks } = resource.series;

  const dates = useMemo(() => points.map((point) => point.price_date), [points]);

  const series = useMemo(
    () => [
      {
        id: 'preco',
        label: 'Preço',
        // A cor é a da classe do papel, e não a primeira da paleta de séries:
        // D-01 cobra que Ações tenha a mesma cor na tabela, na barra de
        // composição e aqui.
        color: colorForToken(resource.asset.color_token),
        points: points.map((point) => ({
          date: point.price_date,
          value: point.adjusted_close,
        })),
      },
    ],
    [points],
  );

  const markers: readonly ChartMarker[] = useMemo(
    () =>
      marks.map((mark) => ({
        id: `${mark.side}-${mark.trade_date}`,
        date: mark.trade_date,
        value: mark.unit_price,
        color: mark.side === 'buy' ? SEMANTIC_COLORS.accent : SEMANTIC_COLORS.negative,
        label: `${mark.side === 'buy' ? 'Compra' : 'Venda'} de ${
          mark.quantity
        } em ${formatShortDate(mark.trade_date)}`,
      })),
    [marks],
  );

  const periodLabel =
    PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? period;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-panel-title font-semibold">Preço em {periodLabel}</h2>
          {resource.series.return_ratio === null ? (
            <span className="text-[0.8125rem] text-ink-3">
              histórico curto demais para a janela
            </span>
          ) : (
            <span className="flex items-baseline gap-2 text-[0.8125rem]">
              <PercentChange value={resource.series.return_ratio} decimals={1} />
              {resource.series.return_with_payouts_ratio === null ? null : (
                <span className="flex items-baseline gap-1 text-ink-3">
                  <PercentChange
                    value={resource.series.return_with_payouts_ratio}
                    decimals={1}
                  />
                  com proventos
                </span>
              )}
            </span>
          )}
          {resource.series.adjusted ? (
            <span
              className="text-[0.75rem] text-ink-3"
              title="A série está na escala de hoje: um evento corporativo do período foi aplicado ao preço anterior a ele."
            >
              série ajustada por evento
            </span>
          ) : null}
        </div>

        <Segmented<PeriodParam>
          label="Janela do gráfico"
          value={period}
          options={PERIOD_OPTIONS}
          onChange={onPeriod}
        />
      </div>

      {/* Gráfico com menos de dois pontos não é desenhado, e a tela diz por
          quê: uma linha de um ponto é uma linha que mente sobre a tendência. */}
      {points.length < 2 ? (
        <p className="py-12 text-center text-[0.8125rem] text-ink-3">
          {points.length === 0
            ? 'Ainda não há preço deste papel na janela escolhida.'
            : 'Um ponto só não desenha uma série: escolha uma janela maior.'}
        </p>
      ) : (
        <SeriesChart
          dates={dates}
          series={series}
          markers={markers}
          markerLegend={
            marks.some((mark) => mark.side === 'sell') ? 'Compras e vendas' : 'Compras'
          }
          valueFormat="money"
          ariaLabel={`Preço de ${assetTitle(resource.asset)} em ${periodLabel}`}
          xTickLabel={(date) => formatShortDate(date)}
          tooltipDateLabel={(date) => formatFullDate(date)}
          {...(resource.position?.avg_price == null
            ? {}
            : {
                reference: {
                  value: resource.position.avg_price,
                  label: `PM ${formatPrice(resource.position.avg_price)}`,
                  legend: 'Preço médio',
                  color: SEMANTIC_COLORS.ink3,
                },
              })}
        />
      )}
    </>
  );
};

/**
 * O gráfico de quem não tem cotação, como o título de banco na curva: o
 * rendimento acumulado sozinho, na própria escala. Empilhado sobre o investido
 * ele quase não aparece — R$ 80 sobre R$ 10 mil é uma linha —, e é o rendimento
 * que a pessoa quer ver subir.
 */
const YieldChart = ({
  resource,
  period,
  onPeriod,
}: {
  readonly resource: AssetPageResource;
  readonly period: PeriodParam;
  readonly onPeriod: (value: PeriodParam) => void;
}): React.ReactElement => {
  const points = resource.series.value_points;
  const last = points[points.length - 1];

  const underwater = points.some((point) => point.result.startsWith('-'));
  const hasPayouts = points.some((point) => compareDecimal(point.payouts, '0') !== 0);
  const dates = useMemo(() => points.map((point) => point.date), [points]);

  const series = useMemo(
    () => [
      {
        id: 'rendimento',
        label: 'Rendimento acumulado',
        color: resultColor(underwater),
        points: points.map((point) => ({ date: point.date, value: point.result })),
      },
      ...(hasPayouts
        ? [
            {
              id: 'com-proventos',
              label: 'Com proventos',
              color: SEMANTIC_COLORS.payouts,
              points: points.map((point) => ({
                date: point.date,
                value: point.result_with_payouts,
              })),
            },
          ]
        : []),
    ],
    [points, underwater, hasPayouts],
  );

  const periodLabel =
    PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? period;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-panel-title font-semibold">
            Rendimento acumulado em {periodLabel}
          </h2>
          {last === undefined ? null : (
            <span className="text-[0.8125rem]">
              <MoneyChange value={last.result} />
            </span>
          )}
        </div>
        <Segmented<PeriodParam>
          label="Janela do gráfico"
          value={period}
          options={PERIOD_OPTIONS}
          onChange={onPeriod}
        />
      </div>

      {points.length < 2 ? (
        <p className="py-12 text-center text-[0.8125rem] text-ink-3">
          {points.length === 0
            ? 'Ainda não há posição deste título na janela escolhida.'
            : 'Um dia só não desenha uma série: escolha uma janela maior.'}
        </p>
      ) : (
        <SeriesChart
          dates={dates}
          series={series}
          valueFormat="money"
          ariaLabel={`Rendimento acumulado de ${assetTitle(resource.asset)} em ${periodLabel}`}
          xTickLabel={(date) => formatShortDate(date)}
          tooltipDateLabel={(date) => formatFullDate(date)}
        />
      )}
    </>
  );
};

/**
 * A evolução da posição, para qualquer ativo: o investido embaixo, o rendimento
 * em cima e os proventos recebidos fechando a pilha — a mesma leitura da Visão
 * geral, só que de um papel. Aporte e rendimento ficam separados.
 */
const EvolutionPanel = ({
  resource,
}: {
  readonly resource: AssetPageResource;
}): React.ReactElement | null => {
  const points = resource.series.value_points;

  const bands = useMemo(
    () =>
      growthBands(
        points.map((point) => ({
          date: point.date,
          contributions: point.cost_basis,
          total: point.value,
          result: point.result,
          payouts: point.payouts,
          with_payouts: point.with_payouts,
        })),
      ),
    [points],
  );

  if (points.length < 2) return null;

  return (
    <Panel title="Evolução da posição" hint="investido, rendimento e proventos recebidos">
      <div className="p-4">
        <SeriesChart
          dates={bands.dates}
          series={[
            {
              id: 'valor',
              label: 'Valor da posição',
              color: SEMANTIC_COLORS.ink,
              points: bands.total,
            },
          ]}
          bands={[
            {
              id: 'investido',
              label: 'Investido',
              color: CONTRIBUTIONS_COLOR,
              values: bands.contributions,
            },
            {
              id: 'rendimento',
              label: bands.underwater ? 'Resultado' : 'Rendimento',
              color: resultColor(bands.underwater),
              values: bands.result,
            },
            ...(bands.hasPayouts
              ? [
                  {
                    id: 'proventos',
                    label: 'Proventos recebidos',
                    color: SEMANTIC_COLORS.payouts,
                    values: bands.payouts,
                  },
                ]
              : []),
          ]}
          valueFormat="money"
          fromZero
          ariaLabel={`Evolução da posição em ${assetTitle(resource.asset)}`}
          xTickLabel={(date) => formatShortDate(date)}
          tooltipDateLabel={(date) => formatFullDate(date)}
        />
      </div>
    </Panel>
  );
};

/** `29.10000000` → `29,10`. Só o rótulo da linha de referência precisa disto. */
const formatPrice = (value: string): string => {
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole},${`${fraction}00`.slice(0, 2)}`;
};

/* -------------------------------------------------------------------------- */

/**
 * De onde vem a renda do papel: a grade de doze meses, o próximo evento e o
 * total recebido. "Yield sobre custo" e não "yield sobre o valor de hoje" de
 * propósito — a pergunta de quem já tem o papel é quanto ele rende sobre o que
 * foi pago por ele, não sobre o que ele vale agora.
 */
/** O bloco só existe para o papel que já pagou, ou vai pagar, algum provento. */
const hasRegisteredPayouts = (resource: AssetPageResource): boolean =>
  compareDecimal(resource.lifetime.payouts_received, '0') !== 0 ||
  compareDecimal(resource.payouts.total_12m, '0') !== 0 ||
  resource.payouts.upcoming.length > 0 ||
  usedPayoutSlices(resource.payouts.months).length > 0;

const PayoutsPanel = ({
  resource,
}: {
  readonly resource: AssetPageResource;
}): React.ReactElement => {
  const months = resource.payouts.months;
  const used = usedPayoutSlices(months);

  const slices = PAYOUT_SLICES.filter((slice) => used.includes(slice.id)).map(
    (slice, index) => ({
      id: slice.id,
      label: slice.label,
      color: colorForSeries(index + 1),
    }),
  );

  const bars: readonly MonthlyBar[] = months.map((month) => ({
    label: monthInitial(month.month),
    values: slices.map((slice) => month[slice.id as keyof typeof month] as string),
    total: month.total,
  }));

  const yieldOnCost = resource.position?.yield_on_cost_12m ?? null;

  return (
    <Panel
      title="Proventos"
      hint={
        yieldOnCost === null
          ? '12 meses'
          : `12 meses · yield sobre custo ${percentText(yieldOnCost)}`
      }
    >
      <div className="grid gap-x-6 gap-y-4 p-4 md:grid-cols-[minmax(0,1fr)_17rem]">
        {slices.length === 0 ? (
          <p className="py-8 text-center text-[0.8125rem] text-ink-3">
            Este papel não pagou provento nos últimos doze meses.
          </p>
        ) : (
          <MonthlyBarsChart
            bars={bars}
            slices={slices}
            height={160}
            ariaLabel={`Proventos de ${assetTitle(resource.asset)} por mês`}
          />
        )}

        <div className="flex flex-col justify-end gap-3 md:border-l md:border-line md:pl-6">
          <p className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
            <span className="text-ink-2">Total 12M</span>
            <span className="font-medium">
              <Money value={resource.payouts.total_12m} />
            </span>
          </p>
          <p className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
            <span className="text-ink-2">Recebido na vida do papel</span>
            <span className="font-medium">
              <Money value={resource.lifetime.payouts_received} />
            </span>
          </p>

          {resource.payouts.upcoming.map((payout) => (
            <p
              key={payout.transaction_id}
              className="flex items-baseline justify-between gap-3 border-t border-line pt-3 text-[0.8125rem]"
            >
              <span className="flex items-baseline gap-2">
                <span className="tabular text-ink-3">
                  {formatShortDate(payout.settlement_date)}
                </span>
                <span>
                  {PAYOUT_KIND_LABELS[payout.payout_kind] ?? payout.payout_kind} · a
                  receber
                </span>
              </span>
              <MoneyChange value={payout.net_amount} />
            </p>
          ))}
        </div>
      </div>
    </Panel>
  );
};

/**
 * O que a linha diz inteira, na dica.
 *
 * "A receber" não ocupa coluna aqui: a prancha o mostra no bloco de Proventos,
 * que é onde a pergunta "o que ainda vai cair" é feita — e uma pastilha a mais
 * nesta coluna cortaria o valor, que é a coluna que ninguém abre a tela para
 * não ver.
 */
const rowTitle = (
  transaction: AssetPageResource['transactions']['recent'][number],
): string => {
  const kind = TRANSACTION_KIND_LABELS[transaction.kind];
  const pending =
    transaction.kind === 'payout' && transaction.confirmed_at === null
      ? ' · a receber'
      : '';
  const payout =
    transaction.payout_kind === null
      ? ''
      : ` (${PAYOUT_KIND_LABELS[transaction.payout_kind] ?? transaction.payout_kind})`;

  return `${kind}${payout}${pending} · ${transaction.portfolio_name}`;
};

/** `0.077000` → `7,7%`. Só o subtítulo do painel precisa disto. */
const percentText = (ratio: string): string => {
  const scaled = (Number(ratio) * 100).toFixed(1).replace('.', ',');
  return `${scaled}%`;
};

/* -------------------------------------------------------------------------- */

/**
 * O histórico do ativo: cada lançamento em uma linha, com filtro por tipo e as
 * mesmas ações de Movimentações — editar, duplicar e excluir (com desfazer).
 * A auditoria em lote e a coluna "Efeito" continuam sendo de Movimentações
 * (T-04), que o menu do ativo abre já filtrada por ele.
 */
const HistoryPanel = ({
  resource,
  kind,
  onKind,
  onChanged,
}: {
  readonly resource: AssetPageResource;
  readonly kind: TransactionKind | null;
  readonly onKind: (value: string | null) => void;
  readonly onChanged: () => void;
}): React.ReactElement => {
  const entry = useEntry();
  const options = kindOptions(resource.transactions.facets);
  const title = assetTitle(resource.asset);
  const [notice, setNotice] = useState<
    | { readonly kind: 'deleted'; readonly undoId: string }
    | { readonly kind: 'error'; readonly message: string }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<
    AssetPageResource['transactions']['recent'][number] | null
  >(null);

  const remove = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      const receipt = await deleteTransaction(id);
      setNotice({ kind: 'deleted', undoId: receipt.undo.undo_id });
    } catch {
      setNotice({
        kind: 'error',
        message: 'Não foi possível excluir. Nada foi alterado.',
      });
    }
    setBusy(false);
    onChanged();
  };

  const undo = async (undoId: string): Promise<void> => {
    setBusy(true);
    try {
      await undoDeletion(undoId);
      setNotice(null);
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'Não foi possível desfazer.',
      });
    }
    setBusy(false);
    onChanged();
  };

  const duplicate = (
    transaction: AssetPageResource['transactions']['recent'][number],
  ): void => {
    const request = duplicateRequest({
      ...transaction,
      asset_id: resource.asset.asset_id,
      ticker: resource.asset.ticker,
      asset_name: resource.asset.name,
    });
    if (request === null) return;
    entry.openEntry({
      tab: request.tab,
      asset: request.asset,
      portfolioId: request.portfolioId,
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    });
  };

  return (
    <Panel
      title="Histórico"
      action={
        <span className="text-[0.8125rem] text-ink-3">
          {transactionsCountLabel(resource.transactions.total)}
        </span>
      }
    >
      <ConfirmDialog
        open={toDelete !== null}
        title="Excluir lançamento?"
        subject={
          toDelete === null
            ? ''
            : `${TRANSACTION_KIND_LABELS[toDelete.kind]} de ${title} em ${formatFullDate(toDelete.trade_date)}`
        }
        consequence="O preço médio e o resultado de tudo que veio depois serão recalculados. Você terá alguns minutos para desfazer."
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          const target = toDelete;
          setToDelete(null);
          if (target !== null) void remove(target.id);
        }}
      />

      {options.length <= 1 ? null : (
        <div
          role="group"
          aria-label="Filtrar por tipo"
          className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5"
        >
          {options.map((option) => (
            <Chip
              key={option.value ?? 'todos'}
              selected={kind === option.value}
              count={option.count}
              onClick={() => onKind(option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      )}

      {notice === null ? null : (
        <p
          role="status"
          className="flex items-center justify-between gap-3 border-b border-line bg-panel-2 px-4 py-2 text-[0.8125rem]"
        >
          <span>
            {notice.kind === 'deleted' ? 'Lançamento excluído.' : notice.message}
          </span>
          {notice.kind === 'deleted' ? (
            <Button disabled={busy} onClick={() => void undo(notice.undoId)}>
              Desfazer
            </Button>
          ) : null}
        </p>
      )}

      {resource.transactions.recent.length === 0 ? (
        <p className="px-4 py-8 text-[0.8125rem] text-ink-3">
          {kind === null
            ? 'Este papel ainda não tem lançamento.'
            : 'Nenhum lançamento deste tipo.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-[0.8125rem]">
            <caption className="sr-only">Histórico de {title}</caption>
            <thead>
              <tr className="tabular text-label tracking-[0.06em] text-ink-3 uppercase">
                <th className="w-28 px-4 py-2 text-left font-medium">Data</th>
                <th className="px-3 py-2 text-left font-medium">Tipo</th>
                <th className="px-3 py-2 text-left font-medium">Carteira</th>
                <th className="px-3 py-2 text-left font-medium">Instituição</th>
                <th className="px-3 py-2 text-right font-medium">Quantidade</th>
                <th className="px-3 py-2 text-right font-medium">Preço</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
                <th className="w-11 px-1.5 py-2">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {resource.transactions.recent.map((transaction) => {
                const quantified = hasQuantityAndPrice(transaction.kind);
                const editable = transaction.kind !== 'corporate_event';
                const label = `${TRANSACTION_KIND_LABELS[transaction.kind]} de ${formatFullDate(transaction.trade_date)}`;

                return (
                  <tr
                    key={transaction.id}
                    className="border-t border-line hover:bg-panel-2"
                    title={rowTitle(transaction)}
                  >
                    <td className="tabular px-4 py-2.5 whitespace-nowrap">
                      {formatFullDate(transaction.trade_date)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {TRANSACTION_KIND_LABELS[transaction.kind]}
                      {transaction.payout_kind === null ? null : (
                        <span className="text-ink-3">
                          {' · '}
                          {PAYOUT_KIND_LABELS[transaction.payout_kind] ??
                            transaction.payout_kind}
                        </span>
                      )}
                      {transaction.kind === 'payout' &&
                      transaction.confirmed_at === null ? (
                        <span className="text-attention"> · a receber</span>
                      ) : null}
                    </td>
                    <td className="max-w-0 min-w-24 px-3 py-2.5 text-ink-2">
                      <span className="block truncate">{transaction.portfolio_name}</span>
                    </td>
                    <td className="max-w-0 min-w-24 px-3 py-2.5 text-ink-2">
                      <span className="block truncate">
                        {transaction.institution_name ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {quantified ? (
                        <Quantity value={transaction.quantity} decimals={0} />
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {quantified ? (
                        <Money value={transaction.unit_price} />
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {transaction.kind === 'payout' ? (
                        <MoneyChange value={transaction.net_amount} />
                      ) : (
                        <Money value={transaction.net_amount} />
                      )}
                    </td>
                    <td className="w-11 px-1.5 py-1">
                      <Menu
                        label={`Ações de ${label}`}
                        items={[
                          {
                            id: 'edit',
                            label: 'Editar',
                            icon: <Icon name="pencil" />,
                            hint: editable ? undefined : 'Evento não é editado aqui',
                            disabled: !editable,
                            onSelect: () => entry.openEdit(transaction.id, title),
                          },
                          {
                            id: 'duplicate',
                            label: 'Duplicar',
                            icon: <Icon name="copy" />,
                            disabled: !editable,
                            onSelect: () => duplicate(transaction),
                          },
                          {
                            id: 'delete',
                            label: 'Excluir',
                            icon: <Icon name="trash" />,
                            destructive: true,
                            onSelect: () => setToDelete(transaction),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */

const B3_TYPE_LABELS: Readonly<Record<string, string>> = {
  stock: 'Ação',
  fii: 'Fundo imobiliário',
  etf: 'ETF',
  bdr: 'BDR',
  treasury: 'Tesouro Direto',
};

const b3TypeLabel = (type: string | null): string =>
  type === null ? 'Renda fixa' : (B3_TYPE_LABELS[type] ?? type);

/* -------------------------------------------------------------------------- */

/**
 * O-08 · O ativo que não existe e a `api` que não respondeu são problemas
 * diferentes, e dizer a frase errada manda a pessoa procurar no lugar errado:
 * um é endereço velho, o outro é a aplicação com um problema.
 */
const AssetError = ({
  assetRef,
  error,
  onBack,
}: {
  readonly assetRef: string;
  readonly error: { readonly message: string; readonly status: number };
  readonly onBack: () => void;
}): React.ReactElement => (
  <div className="flex flex-col items-start gap-3 rounded-panel border border-line bg-panel p-8">
    <h1 className="text-base font-semibold">
      {error.status === 404 ? 'Este ativo não existe' : 'Não deu para abrir o ativo'}
    </h1>
    <p className="text-[0.8125rem] text-ink-3">
      {error.status === 404
        ? `Nenhum papel responde por ${assetRef.toUpperCase()}. Ele pode ter sido excluído, ou o endereço pode estar velho.`
        : error.message}
    </p>
    <Button onClick={onBack}>Voltar para Posições</Button>
  </div>
);
