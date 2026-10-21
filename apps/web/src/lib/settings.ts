import type { MarketHealth, Settings, SettingsBackup } from '@patrimonio/contracts';

/**
 * T-08 · O que a tela de Configurações decide sozinha: texto, ordem e a forma de
 * escrever um limite. Conta nenhuma — contagem, soma e percentual chegam
 * prontos da `api`, e o que o servidor não explica aqui vira traço, nunca um
 * número inventado.
 */

export const SECTIONS = [
  {
    id: 'exibicao',
    group: 'Pessoal',
    label: 'Exibição',
    icon: 'eye',
    keywords: 'tema claro escuro densidade tabelas ocultar valores',
  },
  {
    id: 'carteiras',
    group: 'Espaço',
    label: 'Carteiras',
    icon: 'archive',
    keywords: 'carteira estratégia arquivada ordem barra lateral',
  },
  {
    id: 'mercado',
    group: 'Dados',
    label: 'Dados de mercado',
    icon: 'swap',
    keywords: 'preço cotação fontes índices catálogo coleta atualizar manual',
  },
  {
    id: 'backup',
    group: 'Dados',
    label: 'Dados e backup',
    icon: 'arrow-right',
    keywords: 'exportar csv json importar planilha apagar backup',
  },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export const DEFAULT_SECTION: SectionId = 'exibicao';

export const isSectionId = (value: string | null): value is SectionId =>
  SECTIONS.some((section) => section.id === value);

/** A seção que a URL pede, ou a primeira. `?secao=` inválido não quebra a tela. */
export const sectionFromParam = (value: string | null): SectionId =>
  isSectionId(value) ? value : DEFAULT_SECTION;

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** As seções que a busca de ajuste deixa: rótulo ou palavra-chave contém o texto. */
export const matchSections = (query: string): readonly (typeof SECTIONS)[number][] => {
  const needle = fold(query.trim());
  if (needle === '') return SECTIONS;

  return SECTIONS.filter((section) =>
    fold(`${section.label} ${section.keywords}`).includes(needle),
  );
};

export const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/* -------------------------------------------------------------------------- */
/* Carteira: o que impede excluir                                             */
/* -------------------------------------------------------------------------- */

/**
 * O que prende a exclusão, em palavras. Nulo quando nada prende — a tela então
 * não escreve nada, porque "0 lançamentos" numa linha não diz coisa alguma.
 */
export const portfolioHold = (blocking: {
  readonly transactions: number;
  readonly assets: number;
}): string | null =>
  blocking.transactions === 0
    ? null
    : `${plural(blocking.transactions, 'lançamento', 'lançamentos')} · ${plural(blocking.assets, 'ativo', 'ativos')}`;

export const portfolioCount = (count: number): string =>
  plural(count, 'carteira', 'carteiras');

/* -------------------------------------------------------------------------- */
/* Catálogos da carga inicial                                                 */

type CatalogKey = MarketHealth['catalogs'][number]['key'];

export const CATALOG_LABEL: Readonly<Record<CatalogKey, string>> = {
  institutions: 'Instituições',
  instruments: 'Instrumentos listados',
  treasury: 'Tesouro Direto',
  indices: 'Índices',
  price_history: 'Histórico de preços',
};

/** O comando que preenche cada catálogo; é o que a pendência mostra. */
export const CATALOG_COMMAND: Readonly<Record<CatalogKey, string>> = {
  institutions: 'pnpm seed:institutions',
  instruments: 'pnpm seed:instruments',
  treasury: 'pnpm seed:tesouro',
  indices: 'pnpm seed:indices',
  price_history: 'pnpm seed:cotahist',
};

/** Os catálogos na ordem em que a carga os executa. */
export const CATALOG_ORDER: readonly CatalogKey[] = [
  'institutions',
  'instruments',
  'treasury',
  'indices',
  'price_history',
];

export const orderedCatalogs = (
  catalogs: MarketHealth['catalogs'],
): MarketHealth['catalogs'] =>
  [...catalogs].sort(
    (a, b) => CATALOG_ORDER.indexOf(a.key) - CATALOG_ORDER.indexOf(b.key),
  );

export const hasDemoData = (demo: MarketHealth['demo']): boolean =>
  demo.portfolios + demo.assets + demo.institutions > 0;

export const DEMO_REMOVE_COMMAND = 'pnpm demo:remove';

export const demoSummary = (demo: MarketHealth['demo']): string =>
  [
    plural(demo.portfolios, 'carteira', 'carteiras'),
    plural(demo.assets, 'ativo', 'ativos'),
    plural(demo.institutions, 'instituição', 'instituições'),
  ].join(', ');

/* -------------------------------------------------------------------------- */
/* Dados de mercado                                                           */
/* -------------------------------------------------------------------------- */

const SOURCE_LABEL: Readonly<Record<string, string>> = {
  brapi: 'brapi',
  usebolsai: 'Bolsai',
  bcb: 'Banco Central',
  'tesouro-direto': 'Tesouro Direto',
  'tesouro-transparente': 'Tesouro Transparente',
  cotahist: 'B3 · COTAHIST',
  cotacoes: 'Cotações (IBOV/IFIX)',
  reconcile: 'Reconciliação',
};

const KIND_LABEL: Readonly<Record<string, string>> = {
  quotes: 'Cotações',
  indices: 'Índices',
  treasury: 'Tesouro Direto',
  backfill: 'Histórico de ativo',
  cotahist: 'Carga inicial',
  contract_check: 'Verificação de formato',
  live: 'Prévia do pregão',
  reconcile: 'Reconciliação',
};

export const sourceLabel = (source: string): string => SOURCE_LABEL[source] ?? source;
export const runKindLabel = (kind: string): string => KIND_LABEL[kind] ?? kind;

type SourceStatus = MarketHealth['sources'][number]['status'];
export type Tone = 'ok' | 'attention' | 'error' | 'neutral';

export const SOURCE_STATUS: Readonly<
  Record<SourceStatus, { readonly label: string; readonly tone: Tone }>
> = {
  ok: { label: 'ok', tone: 'ok' },
  stale: { label: 'atrasada', tone: 'attention' },
  failing: { label: 'falhando', tone: 'error' },
  never_run: { label: 'nunca coletou', tone: 'neutral' },
};

/**
 * `2026-10-06T18:02:00Z` → `06/10 15:02`, no fuso de quem usa. A data de negócio
 * é `YYYY-MM-DD` sem fuso; **instante** — quando uma coleta rodou — é outra
 * coisa, e esta é a única função que o converte.
 */
export const formatInstant = (
  iso: string | null,
  timeZone = 'America/Sao_Paulo',
): string => {
  if (iso === null) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${pick('day')}/${pick('month')} ${pick('hour')}:${pick('minute')}`;
};

export const missingPricesText = (missing: MarketHealth['missing_prices']): string => {
  const tickers = missing.map((item) => item.ticker);
  if (tickers.length === 0) return '';

  const shown = tickers
    .slice(0, 3)
    .join(', ')
    .replace(/, ([^,]*)$/, ' e $1');
  const extra = tickers.length > 3 ? ` e mais ${tickers.length - 3}` : '';

  return `${shown}${extra} sem cotação do dia`;
};

/* -------------------------------------------------------------------------- */
/* Backup                                                                     */
/* -------------------------------------------------------------------------- */

export type BackupSummary = { readonly text: string; readonly tone: Tone };

/**
 * O estado do backup numa frase. A falha vem com a mensagem do erro e a data —
 * é o que diz o que fazer —, e só aparece enquanto nenhum backup bem-sucedido
 * veio depois dela (a `api` já entrega assim).
 */
export const backupSummary = (backup: SettingsBackup): BackupSummary => {
  if (!backup.enabled) {
    return { text: 'Backup desligado nesta instalação', tone: 'attention' };
  }

  if (backup.last_failure !== null) {
    return {
      text: `Falhou em ${formatInstant(backup.last_failure.at)}: ${backup.last_failure.error}`,
      tone: 'error',
    };
  }

  if (backup.pending) {
    return { text: 'Backup pedido: aguardando a execução', tone: 'neutral' };
  }

  if (backup.last_success_at === null) {
    return { text: 'Nenhum backup feito ainda', tone: 'attention' };
  }

  return {
    text: `Último backup em ${formatInstant(backup.last_success_at)}`,
    tone: 'ok',
  };
};

/** Settings pode estar vazio, e a tela diz isso em vez de abrir sem seção. */
export const isEmptyInstallation = (settings: Settings): boolean =>
  settings.portfolios.length === 0;

/* -------------------------------------------------------------------------- */
/* Resumo das fontes                                                          */
/* -------------------------------------------------------------------------- */

export type MarketSummary = {
  readonly tone: Tone;
  readonly title: string;
  /** Quantos itens pedem atenção; zero quando tudo está em dia. */
  readonly warnings: number;
  readonly lastLoad: string | null;
};

/**
 * A frase de cima das fontes: tudo em dia, com aviso ou falhando. Contar é só
 * contar o que a `api` já marcou — nenhuma regra de negócio aqui.
 */
export const marketSummary = (health: MarketHealth): MarketSummary => {
  const pending = health.catalogs.filter((catalog) => catalog.state === 'pending').length;
  const failing = health.sources.filter((source) => source.status === 'failing').length;
  const attention = health.sources.filter(
    (source) =>
      source.status === 'stale' ||
      (source.status === 'ok' && source.coverage.missing > 0),
  ).length;
  const warnings = pending + failing + attention;

  const instants = [
    ...health.catalogs.map((catalog) => catalog.last_loaded),
    ...health.sources.map((source) => source.last_run?.finished_at ?? null),
  ].filter((value): value is string => value !== null);
  const lastLoad =
    instants.length === 0
      ? null
      : (instants.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) as string);

  return {
    tone: failing > 0 ? 'error' : warnings > 0 ? 'attention' : 'ok',
    title: failing > 0 ? 'Fonte falhando' : 'Fontes funcionando',
    warnings,
    lastLoad,
  };
};

/** `2026-10-15` → `15/10`: o dia basta ao lado de "último preço de". */
export const shortDate = (date: string): string => {
  const [, month, day] = date.split('-');

  return `${day ?? ''}/${month ?? ''}`;
};
