import { useMemo, useState } from 'react';

import type { TableGroup } from '../lib/table/model.js';
import type { Period } from '../lib/period.js';
import { colorForSeries, colorForToken } from '../lib/tokens.js';
import {
  AllocationBar,
  BarLegend,
  CompositionBar,
  GoalProgressBar,
  GrowthOriginBar,
} from '../components/bars.js';
import {
  AppliedFilters,
  BenchmarkPicker,
  ControlGroup,
  Toolbar,
} from '../components/controls.js';
import { MonthYearGrid } from '../components/month_year_grid.js';
import { MonthlyBarsChart } from '../components/monthly_bars_chart.js';
import {
  Compact,
  Money,
  MoneyChange,
  Percent,
  PercentChange,
  Points,
  Quantity,
  Quota,
} from '../components/number.js';
import { ConfirmDialog, InfoTip, Menu } from '../components/overlay.js';
import { OverviewHeader } from '../components/overview_header.js';
import { PeriodControl } from '../components/period_control.js';
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
import { SearchSelect } from '../components/search_select.js';
import { SeriesChart } from '../components/series_chart.js';
import { AppShell } from '../components/shell.js';
import { useShortcutHelp, useShortcuts } from '../components/shortcuts.js';
import type { TableColumn } from '../components/table.js';
import { DataTable } from '../components/table.js';

/**
 * E5 · Critério de saída.
 *
 * A galeria existe por dois motivos práticos. O primeiro é conferência: cada
 * peça do design system aparece aqui com dado parecido com o real, nos dois
 * temas e nas duas densidades, e é contra esta tela que o resultado é comparado
 * com as pranchas. O segundo é regressão: quando E6 construir as telas, esta
 * página continua sendo o lugar onde uma mudança no botão aparece antes de
 * aparecer em seis telas.
 *
 * Os dados são os das pranchas, de propósito: é mais fácil enxergar um
 * desalinhamento comparando o mesmo número.
 */

const HOJE = '2026-10-06';

type Position = {
  readonly id: string;
  readonly ticker: string;
  readonly name: string;
  readonly institution: string;
  readonly quantity: string;
  readonly avgPrice: string;
  readonly price: string;
  readonly priceHealth: 'fresh' | 'stale' | 'manual' | 'missing';
  readonly value: string;
  readonly weight: string;
  readonly result: string | null;
  readonly resultRatio: string | null;
  readonly detail: string;
};

const position = (
  ticker: string,
  name: string,
  values: Partial<Position> &
    Pick<Position, 'quantity' | 'avgPrice' | 'price' | 'value' | 'weight'>,
): Position => ({
  id: ticker,
  ticker,
  name,
  institution: 'Corretora A',
  priceHealth: 'fresh',
  result: null,
  resultRatio: null,
  detail: '',
  ...values,
});

const acoes: TableGroup<Position> = {
  key: 'acoes',
  label: 'Ações',
  colorToken: 'class.acoes',
  rows: [
    position('ITUB4', 'Itaú Unibanco PN', {
      quantity: '500',
      avgPrice: '29.10',
      price: '36.84',
      value: '18420.00',
      weight: '0.058',
      result: '3870.00',
      resultRatio: '0.266',
      detail: 'DY 6,1%',
    }),
    position('WEGE3', 'WEG ON', {
      quantity: '500',
      avgPrice: '36.80',
      price: '30.46',
      value: '15230.00',
      weight: '0.048',
      result: '-3170.00',
      resultRatio: '-0.172',
    }),
    position('EGIE3', 'Engie Brasil ON', {
      quantity: '300',
      avgPrice: '39.00',
      price: '41.25',
      value: '12375.00',
      weight: '0.039',
      result: '675.00',
      resultRatio: '0.058',
    }),
    position('VALE3', 'Vale ON', {
      quantity: '200',
      avgPrice: '64.10',
      price: '58.40',
      value: '11680.00',
      weight: '0.037',
      result: '-1140.00',
      resultRatio: '-0.089',
    }),
    position('PETR4', 'Petrobras PN', {
      quantity: '340',
      avgPrice: '28.40',
      price: '31.82',
      value: '10818.80',
      weight: '0.034',
      result: '1162.80',
      resultRatio: '0.120',
    }),
    position('DEBCIA', 'Debênture Companhia de Saneamento de Minas Gerais série única', {
      quantity: '1',
      avgPrice: '11111111.00',
      price: '12345678.90',
      value: '12345678.90',
      weight: '0.009',
      result: '1234567.89',
      resultRatio: '0.111',
      detail: 'IPCA + 7,2%',
    }),
    position('CRAGRO', 'CRA Agro 2031', {
      quantity: '10',
      avgPrice: '1000.00',
      price: '1000.00',
      priceHealth: 'missing',
      value: '10000.00',
      weight: '0.003',
      detail: 'sem preço · usa o custo',
    }),
  ],
  summary: { valor: '112640.35', peso: '0.353', resultado: '9820.15' },
};

const rfInflacao: TableGroup<Position> = {
  key: 'rf_inflacao',
  label: 'RF inflação',
  colorToken: 'class.rf-inflacao',
  rows: [
    position('IPCA2035', 'Tesouro IPCA+ 2035', {
      institution: 'Tesouro Direto',
      quantity: '22.4',
      avgPrice: '2010.15',
      price: '2335.29',
      value: '52310.40',
      weight: '0.164',
      result: '7283.04',
      resultRatio: '0.162',
      detail: 'IPCA + 6,82% · 15/05/2035',
    }),
    position('IPCA2045', 'Tesouro IPCA+ 2045', {
      institution: 'Tesouro Direto',
      quantity: '21.05',
      avgPrice: '1287.41',
      price: '1360.57',
      priceHealth: 'stale',
      value: '28640.00',
      weight: '0.090',
      result: '1540.00',
      resultRatio: '0.057',
      detail: 'IPCA + 7,10% · 15/05/2045',
    }),
  ],
  summary: { valor: '80950.40', peso: '0.254', resultado: '8823.04' },
};

const COLUMNS: readonly TableColumn<Position>[] = [
  {
    id: 'ativo',
    header: 'Ativo',
    essential: true,
    flexible: true,
    sortable: true,
    sortValue: (row) => row.ticker,
    cell: (row) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium">{row.ticker}</span>
        <span className="block truncate text-[0.75rem] text-ink-3">
          {row.institution}
        </span>
      </span>
    ),
  },
  {
    id: 'quantidade',
    header: 'Qtd',
    numeric: true,
    hideBelow: 1000,
    sortable: true,
    sortValue: (row) => row.quantity,
    cell: (row) => <Quantity value={row.quantity} />,
  },
  {
    id: 'preco_medio',
    header: 'Preço médio',
    numeric: true,
    hideBelow: 1400,
    cell: (row) => <Money value={row.avgPrice} />,
  },
  {
    id: 'preco',
    header: 'Preço',
    numeric: true,
    hideBelow: 1100,
    cell: (row) => (
      <span>
        <PriceHealthDot kind={row.priceHealth} />
        <Money value={row.price} />
      </span>
    ),
  },
  {
    id: 'valor',
    header: 'Valor',
    numeric: true,
    essential: true,
    sortable: true,
    sortValue: (row) => row.value,
    cell: (row) => <Money value={row.value} />,
    summary: (summary) => <Money value={summary['valor'] ?? null} />,
  },
  {
    id: 'peso',
    header: 'Peso',
    numeric: true,
    hideBelow: 1000,
    cell: (row) => <Percent value={row.weight} decimals={1} />,
    summary: (summary) => <Percent value={summary['peso'] ?? null} decimals={1} />,
  },
  {
    id: 'resultado',
    header: 'Resultado',
    numeric: true,
    hideBelow: 1100,
    sortable: true,
    sortValue: (row) => row.result,
    cell: (row) => (
      <span className="flex items-center justify-end gap-2">
        <MoneyChange value={row.result} />
        <span aria-hidden="true" className="text-ink-3">
          ·
        </span>
        <PercentChange value={row.resultRatio} decimals={1} />
      </span>
    ),
    summary: (summary) => <MoneyChange value={summary['resultado'] ?? null} />,
  },
  {
    id: 'detalhe',
    header: 'Detalhe',
    hideBelow: 1400,
    cell: (row) => <span className="text-ink-2">{row.detail}</span>,
  },
];

const DATES = Array.from({ length: 13 }, (_, index) => {
  const month = ((9 + index) % 12) + 1;
  const year = 2025 + Math.floor((9 + index) / 12);
  return `${year}-${String(month).padStart(2, '0')}-28`;
});

const SCREENS = [
  { id: 'visao', label: 'Visão geral', icon: '▦' },
  { id: 'posicoes', label: 'Posições', icon: '≡' },
  { id: 'movimentacoes', label: 'Movimentações', icon: '⇄' },
  { id: 'desempenho', label: 'Desempenho', icon: '◹' },
  { id: 'estrategia', label: 'Estratégia', icon: '◎' },
  { id: 'objetivos', label: 'Objetivos', icon: '⚑' },
];

const PORTFOLIOS = [
  { id: 'longo', label: 'Longo prazo', value: '318904.12' },
  { id: 'imovel', label: 'Entrada do imóvel', value: '84800' },
  { id: 'reserva', label: 'Reserva', value: '62400' },
  { id: 'curto', label: 'Curto prazo', value: '21200' },
];

const ALLOCATION = [
  { id: 'acoes', label: 'Ações', colorToken: 'class.acoes', share: '0.353' },
  { id: 'fiis', label: 'FIIs', colorToken: 'class.fiis', share: '0.241' },
  {
    id: 'rf_inflacao',
    label: 'RF inflação',
    colorToken: 'class.rf-inflacao',
    share: '0.254',
  },
  { id: 'rf_pre', label: 'RF prefixada', colorToken: 'class.rf-pre', share: '0.130' },
  { id: 'caixa', label: 'Caixa', colorToken: 'class.caixa', share: '0.023' },
];

export const Gallery = (): React.ReactElement => {
  const { theme, setTheme, density, setDensity, hidden, setHidden } = usePreferences();
  const openHelp = useShortcutHelp();

  const [scope, setScope] = useState('longo');
  const [screen, setScreen] = useState('posicoes');
  const [period, setPeriod] = useState<Period>({ kind: 'preset', preset: '12m' });
  const [benchmarks, setBenchmarks] = useState<readonly string[]>(['cdi', 'ipca6']);
  const [portfolio, setPortfolio] = useState<string | null>('longo');
  const [confirming, setConfirming] = useState(false);
  const [filters, setFilters] = useState<readonly string[]>(['classe', 'instituicao']);

  // D-11 em uso: a navegação por sequência de duas teclas vale na galeria como
  // valerá nas telas de E6, porque é o mesmo registro.
  useShortcuts(
    useMemo(
      () => ({
        go_overview: () => setScreen('visao'),
        go_positions: () => setScreen('posicoes'),
        go_transactions: () => setScreen('movimentacoes'),
        go_performance: () => setScreen('desempenho'),
        go_strategy: () => setScreen('estrategia'),
        go_goals: () => setScreen('objetivos'),
        new_transaction: openHelp,
        search: openHelp,
      }),
      [openHelp],
    ),
  );

  const series = useMemo(
    () => [
      {
        id: 'carteira',
        label: 'Longo prazo',
        color: colorForSeries(0),
        points: DATES.map((date, index) => ({
          date,
          // Um buraco no meio, para a regra "buraco é buraco" ficar visível.
          value: index === 7 ? null : String((0.301 * index) / 12),
        })),
      },
      {
        id: 'ipca6',
        label: 'IPCA + 6%',
        color: colorForSeries(3),
        points: DATES.map((date, index) => ({
          date,
          value: String((0.2319 * index) / 12),
        })),
      },
      {
        id: 'cdi',
        label: 'CDI',
        color: 'var(--color-series-benchmark)',
        dashed: true,
        points: DATES.map((date, index) => ({
          date,
          value: String((0.2929 * index) / 12),
        })),
      },
    ],
    [],
  );

  return (
    <AppShell
      portfolios={PORTFOLIOS}
      screens={SCREENS}
      scope={scope}
      screen={screen}
      onNavigate={(nextScope, nextScreen) => {
        setScope(nextScope);
        setScreen(nextScreen);
      }}
      onOpenSearch={openHelp}
      onOpenSettings={openHelp}
    >
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-screen-title font-semibold tracking-tight">
              Design system
            </h1>
            <p className="text-[0.8125rem] text-ink-3">
              E5 · cada peça com dado das pranchas, nos dois temas e nas duas densidades
            </p>
          </div>

          <Toolbar>
            <Segmented
              label="Tema"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'light', label: 'Claro' },
                { value: 'dark', label: 'Escuro' },
                { value: 'system', label: 'Sistema' },
              ]}
            />
            <Segmented
              label="Densidade"
              value={density}
              onChange={setDensity}
              options={[
                { value: 'comfortable', label: 'Confortável' },
                { value: 'compact', label: 'Compacta' },
              ]}
            />
            <IconButton
              label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
              onClick={() => setHidden(!hidden)}
            >
              ◉
            </IconButton>
            <Button shortcut="?" onClick={openHelp}>
              Atalhos
            </Button>
          </Toolbar>
        </header>

        <OverviewHeader
          label="Patrimônio · Longo prazo"
          principal="487320.55"
          change={{ amount: '1512.30', ratio: '0.0031', periodLabel: 'em outubro' }}
          caveat="dois preços de 03/10"
          metrics={[
            { label: 'Rent. 12M', value: <PercentChange value="0.1384" /> },
            { label: 'Aportes 12M', value: <Money value="59200" /> },
            { label: 'Rendimento 12M', value: <MoneyChange value="56500" /> },
            {
              label: 'Peso no patrimônio',
              value: <Percent value="0.654" decimals={1} />,
            },
          ]}
          chart={
            <SeriesChart
              dates={DATES}
              series={series}
              valueFormat="percent"
              fromZero={false}
              ariaLabel="Retorno acumulado contra benchmarks"
              xTickLabel={(date) => date.slice(2, 7).split('-').reverse().join('/')}
              tooltipDateLabel={(date) => date.split('-').reverse().join('/')}
            />
          }
        />

        <Panel title="Tabela densa" hint="agrupamento, subtotal e colapso de coluna">
          <div className="p-4">
            <DataTable<Position>
              screen="galeria-posicoes"
              caption="Posições abertas hoje"
              columns={COLUMNS}
              groups={[acoes, rfInflacao]}
              rowId={(row) => row.id}
              rowLabel={(row) => `${row.ticker} · ${row.name}`}
              total={{ valor: '487320.55', peso: '1', resultado: '25673.59' }}
              rowsPerGroup={5}
              rowActions={(row) => (
                <Menu
                  label={`Ações de ${row.ticker}`}
                  items={[
                    {
                      id: 'lancar',
                      label: 'Lançar compra ou venda',
                      shortcut: 'L',
                      onSelect: () => {},
                    },
                    { id: 'provento', label: 'Lançar provento', onSelect: () => {} },
                    {
                      id: 'abrir',
                      label: 'Abrir ativo',
                      shortcut: '↵',
                      onSelect: () => {},
                    },
                    {
                      id: 'arquivar',
                      label: 'Arquivar ativo',
                      hint: 'zere a posição antes',
                      destructive: true,
                      onSelect: () => setConfirming(true),
                    },
                  ]}
                />
              )}
            />
          </div>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Controles" hint="altura única de 34 px">
            <div className="flex flex-col gap-4 p-4">
              <ControlGroup label="Período">
                <PeriodControl
                  value={period}
                  onChange={setPeriod}
                  today={HOJE}
                  inception="2021-03-15"
                />
              </ControlGroup>

              <ControlGroup label="Filtros e escopo">
                <AppliedFilters
                  filters={filters.map((id) => ({
                    id,
                    label:
                      id === 'classe'
                        ? 'Classe: Ações, FIIs'
                        : 'Instituição: Corretora A',
                    onRemove: () =>
                      setFilters((current) => current.filter((entry) => entry !== id)),
                  }))}
                  onClearAll={() => setFilters([])}
                />
                <div className="w-56">
                  <SearchSelect
                    label="Carteira"
                    value={portfolio}
                    onChange={setPortfolio}
                    options={PORTFOLIOS.map((entry) => ({
                      id: entry.id,
                      label: entry.label,
                      value: entry.value,
                    }))}
                  />
                </div>
              </ControlGroup>

              <ControlGroup label="Benchmarks">
                <BenchmarkPicker
                  selected={benchmarks}
                  onChange={setBenchmarks}
                  options={[
                    { id: 'cdi', label: 'CDI' },
                    { id: 'ipca6', label: 'IPCA + 6%', locked: true },
                    { id: 'ibov', label: 'IBOV' },
                    { id: 'ifix', label: 'IFIX' },
                    { id: 'misto', label: '50% CDI + 50% IBOV' },
                  ]}
                />
              </ControlGroup>

              <ControlGroup label="Botões">
                <Button variant="primary" shortcut="N">
                  Lançamento
                </Button>
                <Button>Exportar CSV</Button>
                <Chip colorToken="class.acoes" count={14} selected>
                  Ações
                </Chip>
                <Chip colorToken="class.fiis" count={9}>
                  FIIs
                </Chip>
                <InfoTip label="O que é cota">
                  A cota isola o efeito dos aportes: ela mede o rendimento sem contar o
                  dinheiro que entrou.
                </InfoTip>
              </ControlGroup>

              <ControlGroup label="Saúde do preço">
                <span className="flex items-center gap-4 text-[0.8125rem] text-ink-2">
                  <span>
                    <PriceHealthDot kind="fresh" showFresh />
                    atualizado
                  </span>
                  <span>
                    <PriceHealthDot kind="stale" />
                    atrasado ou fonte alternativa
                  </span>
                  <span>
                    <PriceHealthDot kind="missing" />
                    sem preço · usa custo
                  </span>
                </span>
              </ControlGroup>
            </div>
          </Panel>

          <Panel title="Barras de proporção" hint="no lugar de pizza e donut">
            <div className="flex flex-col gap-5 p-4">
              <div className="flex flex-col gap-2">
                <Label>Atual × alvo</Label>
                <AllocationBar
                  label="RF pós-fixada"
                  colorToken="class.rf-pos"
                  current="0.292"
                  target="0.25"
                  deviation="4.2"
                  withinTolerance={false}
                />
                <AllocationBar
                  label="Ações"
                  colorToken="class.acoes"
                  current="0.353"
                  target="0.35"
                  deviation="0.3"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Composição</Label>
                <CompositionBar label="Composição por classe" slices={ALLOCATION} />
                <BarLegend slices={ALLOCATION} />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Origem do crescimento</Label>
                <GrowthOriginBar
                  contributionsShare="0.512"
                  contributions="59200"
                  returns="56500"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Progresso de objetivo</Label>
                <GoalProgressBar
                  label="Imóvel 2028"
                  caption="R$ 84.775 de R$ 100.000 · marca = onde deveria estar hoje"
                  progress="0.85"
                  expected="0.78"
                />
                <GoalProgressBar
                  label="Reserva de emergência"
                  caption="atingido · excedente de R$ 2.410 · sem data"
                  progress="1.04"
                  state="reached"
                />
                <GoalProgressBar
                  label="Viagem 2026"
                  caption="prazo encerrou em jun/2026 · faltaram R$ 2.400"
                  progress="0.92"
                  state="behind"
                />
              </div>
            </div>
          </Panel>
        </div>

        <Panel
          title="Retornos mensais"
          hint="escala divergente compartilhada por toda a grade"
        >
          <div className="p-4">
            <MonthYearGrid
              caption="Rentabilidade da cota, mês a mês"
              format="percent"
              totalHeader="Ano"
              extraHeaders={['IPCA+6', 'Diferença']}
              years={[
                {
                  year: 2026,
                  partial: true,
                  months: [
                    '0.0077',
                    '0.0134',
                    '0.0172',
                    '0.0109',
                    '0.0233',
                    '0.0016',
                    '0.0046',
                    '0.0220',
                    '0.0098',
                    null,
                    null,
                    null,
                  ],
                  total: '0.1158',
                  extras: ['0.0710', '0.0448'],
                },
                {
                  year: 2025,
                  months: [
                    '0.0263',
                    '0.0222',
                    '0.0169',
                    '-0.0146',
                    '0.0023',
                    '0.0209',
                    '-0.0125',
                    '0.0079',
                    '0.0231',
                    '-0.0063',
                    '0.0289',
                    '0.0162',
                  ],
                  total: '0.1381',
                  extras: ['0.1060', '0.0321'],
                },
                {
                  year: 2024,
                  months: [
                    '0.0586',
                    '0.0123',
                    '0.0204',
                    '-0.0134',
                    '0.0064',
                    '0.0184',
                    '0.0076',
                    '0.0156',
                    '0.0113',
                    '0.0168',
                    '0.0171',
                    '-0.0094',
                  ],
                  total: '0.1723',
                  extras: ['0.1090', '0.0633'],
                },
              ]}
            />
          </div>
        </Panel>

        <Panel
          title="Proventos por mês"
          hint="barras empilhadas por tipo, a partir do zero"
        >
          <div className="p-4">
            <MonthlyBarsChart
              ariaLabel="Proventos recebidos por mês"
              slices={[
                {
                  id: 'dividendo',
                  label: 'Dividendo',
                  color: colorForToken('class.acoes'),
                },
                { id: 'jcp', label: 'JCP', color: colorForToken('class.rf-pre') },
                {
                  id: 'aluguel',
                  label: 'Aluguel de FII',
                  color: colorForToken('class.fiis'),
                },
              ]}
              bars={[
                { label: 'mai', values: ['620', '300', '320'], total: '1240' },
                { label: 'jun', values: ['700', '260', '330'], total: '1290' },
                { label: 'jul', values: ['540', '220', '345'], total: '1105' },
                { label: 'ago', values: ['600', '200', '350'], total: '1150' },
                { label: 'set', values: ['680', '243.40', '360'], total: '1283.40' },
                { label: 'out', values: ['300', '96.12', '180'], total: '576.12' },
              ]}
            />
          </div>
        </Panel>

        <Panel title="Números" hint="mono tabular, alinhado pela vírgula">
          <table className="w-full text-cell">
            <tbody>
              {(
                [
                  ['Valor monetário', <Money key="a" value="1204.1" />],
                  ['Variação em reais', <MoneyChange key="b" value="-3170" />],
                  ['Variação percentual', <PercentChange key="c" value="0.0025" />],
                  ['Diferença de alocação', <Points key="d" value="4.2" />],
                  ['Quantidade inteira', <Quantity key="e" value="500" />],
                  ['Quantidade fracionária', <Quantity key="f" value="22.4" />],
                  ['Quantidade mínima', <Quantity key="g" value="0.000000005" />],
                  ['Cota', <Quota key="h" value="1.23456789" />],
                  ['Compacto', <Compact key="i" value="318900" />],
                  ['Zero', <Money key="j" value="0" />],
                  ['Sem dado', <Money key="k" value={null} />],
                ] as const
              ).map(([label, node]) => (
                <tr key={label} className="border-b border-line last:border-b-0">
                  <td className="h-(--row-height) px-4 text-ink-2">{label}</td>
                  <td className="px-4 text-right">{node}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Arquivar ativo"
        subject="o ativo CRA Agro 2031, com 10 unidades em Curto prazo"
        consequence="O histórico de lançamentos continua; o ativo some das telas de posição."
        confirmLabel="Arquivar"
        onConfirm={() => setConfirming(false)}
        onCancel={() => setConfirming(false)}
      />
    </AppShell>
  );
};
