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
import { Menu } from '../components/overlay.js';
import { useEntry } from '../components/entry_provider.js';
import type { OpenEntryRequest } from '../components/entry_provider.js';
import { KeepPrevious } from '../components/pending.js';
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
import type { ChartMarker } from '../components/series_chart.js';
import {
  CORPORATE_EVENT_LABELS,
  DEFAULT_ASSET_PERIOD,
  PAYOUT_KIND_LABELS,
  PAYOUT_SLICES,
  PERIOD_OPTIONS,
  PERIOD_PARAM,
  TRANSACTION_KIND_LABELS,
  assetState,
  assetTitle,
  eventRatioLabel,
  fixedIncomeFacts,
  hasQuantityAndPrice,
  isPeriodParam,
  kindOptions,
  monthInitial,
  priceStamp,
  transactionsCountLabel,
  usedPayoutSlices,
} from '../lib/asset_page.js';
import type { PeriodParam } from '../lib/asset_page.js';
import { formatFullDate, formatShortDate } from '../lib/positions.js';
import { SEMANTIC_COLORS, colorForSeries, colorForToken } from '../lib/tokens.js';
import { ManualPriceDialog } from './manual_price_dialog.js';
import type { ManualPriceTarget } from './manual_price_dialog.js';

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

/** O que ainda não existe, e qual história o entrega. */
const PENDING_ASSET_FORM = 'o cadastro do ativo chega com T-10';

export type AssetScreenProps = {
  /** Código ou identificador: o endereço aceita os dois. */
  readonly assetRef: string;
  /** Nulo é o escopo de todas as carteiras. */
  readonly portfolioId: string | null;
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
    return (
      <p className="px-1 py-10 text-sm text-ink-3">
        {pending ? 'Carregando o ativo…' : 'Nada a mostrar.'}
      </p>
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
    ...(portfolioId === null ? {} : { portfolioId }),
  });

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Trilha" className="flex items-center gap-1.5 text-[0.75rem]">
        <button
          type="button"
          className="cursor-pointer text-ink-3 hover:text-ink hover:underline"
          onClick={onBack}
        >
          Posições
        </button>
        <span aria-hidden="true" className="text-ink-3">
          ›
        </span>
        <span className="text-ink-2">{title}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="tabular truncate text-[1.625rem] leading-8 font-semibold">
              {title}
            </h1>
            <p className="truncate text-sm text-ink-2" title={resource.asset.name}>
              {resource.asset.name}
            </p>
          </div>

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

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col items-end">
            <span className="tabular text-[1.5rem] leading-7 font-semibold">
              {resource.price.value === null ? (
                <span className="text-ink-3">—</span>
              ) : (
                <Money value={resource.price.value} />
              )}
            </span>
            <span className="flex items-center gap-1.5 text-[0.75rem] text-ink-3">
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

          <IconButton
            label={valuesHidden ? 'Mostrar valores' : 'Ocultar valores'}
            aria-pressed={valuesHidden}
            onClick={toggleHidden}
          >
            {valuesHidden ? '⦰' : '◉'}
          </IconButton>

          <Button disabled title={PENDING_ASSET_FORM}>
            Editar ativo
          </Button>

          <Menu
            label={`Ações de ${title}`}
            items={[
              {
                id: 'manual_price',
                label: 'Definir preço manual',
                onSelect: () => setManualPriceOpen(true),
              },
              {
                id: 'transfer',
                label: 'Mover entre carteiras',
                onSelect: () => entry.openEntry(entryFor('transfer')),
              },
              {
                id: 'transactions',
                label: 'Ver todos os lançamentos',
                disabled: onOpenStatement === undefined,
                onSelect: () => onOpenStatement?.(title),
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
      </header>

      <KeepPrevious pending={pending}>
        <div className="flex flex-col gap-4">
          {/* A faixa de cima: o que é imediato. Os dois blocos dividem a mesma
              moldura, como a prancha desenha — a posição à esquerda não é um
              painel separado do gráfico, é a legenda dele. */}
          <section className="flex flex-wrap items-stretch rounded-panel border border-line bg-panel">
            <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1 p-5 md:max-w-[21rem]">
              <Label className="mb-2">
                Sua posição{portfolioId === null ? '' : ` · ${scopeLabel}`}
              </Label>
              <PositionFacts resource={resource} state={state} />
            </div>

            <div className="flex min-w-0 flex-[3_1_32rem] flex-col gap-3 border-line p-5 md:border-l">
              <PriceChart
                resource={resource}
                period={period}
                onPeriod={(value) =>
                  update({ janela: value === DEFAULT_ASSET_PERIOD ? null : value })
                }
              />
            </div>
          </section>

          {/* A faixa de baixo: o contexto. Três blocos de altura igual, que
              empilham em ordem de importância em tela estreita (O-10). */}
          {/* Os três não dividem a largura em partes iguais: o do meio é uma
              tabela de quatro colunas, e os outros dois são um gráfico de
              barras e uma lista de pares. Partes iguais fariam a tabela cortar
              o valor, que é a coluna que ninguém abre a tela para não ver. */}
          <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_1.3fr_1fr]">
            <PayoutsPanel resource={resource} />
            <TransactionsPanel
              resource={resource}
              kind={kind}
              onKind={(value) => update({ tipo: value })}
            />
            <AssetDataPanel
              resource={resource}
              onManualPrice={() => setManualPriceOpen(true)}
              onTransfer={() => entry.openEntry(entryFor('transfer'))}
            />
          </div>
        </div>
      </KeepPrevious>

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
 * As seis linhas da esquerda, que são as da prancha. Posição zerada não mostra
 * seis zeros: ela diz que está zerada e aponta para o histórico, porque um zero
 * em "quantidade" e um zero em "resultado" querem dizer coisas diferentes.
 */
const PositionFacts = ({
  resource,
  state,
}: {
  readonly resource: AssetPageResource;
  readonly state: ReturnType<typeof assetState>;
}): React.ReactElement => {
  if (resource.position === null) {
    return (
      <p className="py-2 text-[0.8125rem] text-ink-3">
        {state === 'never_closed'
          ? 'Ainda não houve fechamento: a posição aparece depois do primeiro.'
          : 'Posição zerada. O histórico do papel continua abaixo.'}
      </p>
    );
  }

  const position = resource.position;
  const curve = position.unit === 'curve';

  return (
    <dl className="flex flex-col">
      {curve ? (
        <>
          <Row label="Valor na curva">
            <Money value={position.value} />
          </Row>
          <Row label="Aplicado">
            <Money value={position.cost_basis} />
          </Row>
          <Row label="Juros acumulados">
            <MoneyChange value={position.accrued_interest} />
          </Row>
        </>
      ) : (
        <>
          <Row label="Quantidade">
            <Quantity value={position.quantity} />
          </Row>
          <Row label="Preço médio">
            <Money value={position.avg_price} />
          </Row>
          <Row label="Custo total">
            <Money value={position.cost_basis} />
          </Row>
          <Row label="Valor">
            <Money value={position.value} />
          </Row>
        </>
      )}

      <Row label="Resultado">
        <span className="flex items-baseline gap-2">
          <MoneyChange value={position.open_result} />
          <span aria-hidden="true" className="text-ink-3">
            ·
          </span>
          <PercentChange value={position.open_result_ratio} decimals={1} />
        </span>
      </Row>

      {/* Nunca vendido é ausência, e a linha some: `R$ 0,00` em "realizado"
          leria como "vendi e não ganhei nada". */}
      {position.realized_result === null ? null : (
        <Row label="Resultado realizado">
          <MoneyChange value={position.realized_result} />
        </Row>
      )}

      <Row label="Proventos 12M">
        <Money value={position.payouts_12m} />
      </Row>
      <Row label="Peso na carteira">
        <Percent value={position.weight} decimals={1} />
      </Row>
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
      className="flex flex-col"
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
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
                {PAYOUT_KIND_LABELS[payout.payout_kind] ?? payout.payout_kind} · a receber
              </span>
            </span>
            <MoneyChange value={payout.net_amount} />
          </p>
        ))}
      </div>

      {/* O rodapé fica colado embaixo mesmo com conteúdo curto (O-10). */}
      <footer className="mt-auto flex items-baseline justify-between gap-3 border-t border-line px-4 py-3 text-[0.8125rem]">
        <span className="text-ink-2">Total 12M</span>
        <span className="font-medium">
          <Money value={resource.payouts.total_12m} />
        </span>
      </footer>
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
 * Os lançamentos do ativo, com filtro por tipo. A lista é curta de propósito:
 * ela existe para reconhecer o lançamento, não para auditá-lo — a coluna
 * "Efeito" e a seleção em lote são de Movimentações (T-04), que o menu
 * do ativo abre já filtrada por ele.
 */
const TransactionsPanel = ({
  resource,
  kind,
  onKind,
}: {
  readonly resource: AssetPageResource;
  readonly kind: TransactionKind | null;
  readonly onKind: (value: string | null) => void;
}): React.ReactElement => {
  const options = kindOptions(resource.transactions.facets);

  return (
    <Panel
      title="Lançamentos"
      action={
        <span className="text-[0.8125rem] text-ink-3">
          {transactionsCountLabel(resource.transactions.total)}
        </span>
      }
      className="flex flex-col"
    >
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

      <div className="flex-1 px-1 py-1">
        {resource.transactions.recent.length === 0 ? (
          <p className="px-3 py-8 text-[0.8125rem] text-ink-3">
            {kind === null
              ? 'Este papel ainda não tem lançamento.'
              : 'Nenhum lançamento deste tipo.'}
          </p>
        ) : (
          <table className="w-full table-fixed">
            <caption className="sr-only">
              Lançamentos de {assetTitle(resource.asset)}
            </caption>
            <thead>
              <tr className="text-label tracking-wide text-ink-3 uppercase">
                <th className="w-[6.5rem] px-2 py-1.5 text-left font-medium">Data</th>
                <th className="px-2 py-1.5 text-left font-medium">Tipo</th>
                <th className="w-[7rem] px-2 py-1.5 text-right font-medium">
                  Qtd × preço
                </th>
                <th className="w-[5.75rem] px-2 py-1.5 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {resource.transactions.recent.map((transaction) => (
                <tr
                  key={transaction.id}
                  className="border-t border-line"
                  title={rowTitle(transaction)}
                >
                  <td className="tabular px-2 py-2 whitespace-nowrap">
                    {formatFullDate(transaction.trade_date)}
                  </td>
                  <td className="truncate px-2 py-2">
                    {TRANSACTION_KIND_LABELS[transaction.kind]}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {hasQuantityAndPrice(transaction.kind) ? (
                      <span className="tabular">
                        <Quantity value={transaction.quantity} decimals={0} /> ×{' '}
                        <Money value={transaction.unit_price} bare />
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {transaction.kind === 'payout' ? (
                      <MoneyChange value={transaction.net_amount} bare />
                    ) : (
                      <Money value={transaction.net_amount} bare />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */

/**
 * O cadastro: o que o papel é, de onde vem o preço dele e que eventos já foram
 * aplicados. É o bloco que responde "por que este número está assim".
 */
const AssetDataPanel = ({
  resource,
  onManualPrice,
  onTransfer,
}: {
  readonly resource: AssetPageResource;
  readonly onManualPrice: () => void;
  readonly onTransfer: () => void;
}): React.ReactElement => {
  const asset = resource.asset;
  const fixedIncome = fixedIncomeFacts(asset);

  return (
    <Panel title="Dados do ativo" className="flex flex-col">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 p-4 text-[0.8125rem]">
        {asset.category_name === null ? null : (
          <Fact label="Categoria">
            {asset.category_name}
            <span className="text-ink-3">
              {' · '}
              {asset.category_automatic ? 'automática' : 'manual'}
            </span>
          </Fact>
        )}
        <Fact label="Tipo">{b3TypeLabel(asset.b3_type)}</Fact>
        {asset.sector === null ? null : <Fact label="Setor">{asset.sector}</Fact>}
        <Fact label="Fonte de preço">
          {asset.price_source === 'manual' ? 'manual' : 'automática · fechamento diário'}
        </Fact>
        <Fact label="Origem">
          {asset.origin === 'market' ? 'Base de mercado' : 'Cadastrado à mão'}
        </Fact>
        <Fact label="Carteiras">
          {resource.portfolios.length === 0
            ? '—'
            : resource.portfolios.map((item) => item.portfolio_name).join(', ')}
        </Fact>

        {fixedIncome.map((fact) => (
          <Fact key={fact.label} label={fact.label}>
            {fact.value}
          </Fact>
        ))}
      </dl>

      {/* Os eventos aplicados, que é o que explica uma quantidade que mudou sem
          nenhuma compra. O anunciado aparece marcado: ele ainda não mexeu em
          nada, e a confirmação é de M-14. */}
      {resource.corporate_events.length === 0 ? null : (
        <div className="border-t border-line px-4 py-3">
          <Label>Eventos corporativos</Label>
          <ul className="mt-2 flex flex-col gap-1.5 text-[0.8125rem]">
            {resource.corporate_events.map((event) => (
              <li key={event.id} className="flex items-baseline justify-between gap-3">
                <span>
                  {CORPORATE_EVENT_LABELS[event.kind] ?? event.kind}{' '}
                  <span className="tabular text-ink-2">
                    {eventRatioLabel(event.ratio_from, event.ratio_to)}
                  </span>
                </span>
                <span className="tabular flex items-baseline gap-2 text-ink-3">
                  {formatShortDate(event.record_date)}
                  {event.confirmed_at === null ? (
                    <span className="text-attention">a confirmar</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="mt-auto flex flex-wrap gap-2 border-t border-line px-4 py-3">
        <Button onClick={onManualPrice}>Preço manual</Button>
        <Button onClick={onTransfer}>Mover entre carteiras</Button>
      </footer>
    </Panel>
  );
};

const B3_TYPE_LABELS: Readonly<Record<string, string>> = {
  stock: 'Ação',
  fii: 'Fundo imobiliário',
  etf: 'ETF',
  bdr: 'BDR',
  treasury: 'Tesouro Direto',
  cash: 'Caixa',
};

const b3TypeLabel = (type: string | null): string =>
  type === null ? 'Renda fixa' : (B3_TYPE_LABELS[type] ?? type);

const Fact = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <>
    <dt className="whitespace-nowrap text-ink-3">{label}</dt>
    <dd className="truncate text-right">{children}</dd>
  </>
);

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
