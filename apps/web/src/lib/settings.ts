import type {
  MarketHealth,
  Settings,
  SettingsAlertRule,
  SettingsBackup,
  SettingsCategory,
} from '@patrimonio/contracts';

/**
 * T-08 · O que a tela de Configurações decide sozinha: texto, ordem e a forma de
 * escrever um limite. Conta nenhuma — contagem, soma e percentual chegam
 * prontos da `api`, e o que o servidor não explica aqui vira traço, nunca um
 * número inventado.
 */

export const SECTIONS = [
  { id: 'carteiras', label: 'Carteiras' },
  { id: 'alertas', label: 'Alertas' },
  { id: 'categorias', label: 'Categorias de ativo' },
  { id: 'instituicoes', label: 'Instituições' },
  { id: 'mercado', label: 'Dados de mercado' },
  { id: 'lancamentos', label: 'Lançamentos' },
  { id: 'exibicao', label: 'Exibição' },
  { id: 'backup', label: 'Dados e backup' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export const isSectionId = (value: string | null): value is SectionId =>
  SECTIONS.some((section) => section.id === value);

/** A seção que a URL pede, ou a primeira. `?secao=` inválido não quebra a tela. */
export const sectionFromParam = (value: string | null): SectionId =>
  isSectionId(value) ? value : 'carteiras';

export const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/* -------------------------------------------------------------------------- */
/* Carteiras, categorias e instituições: o que impede excluir                  */
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

export const institutionHold = portfolioHold;

export const categoryHold = (
  category: Pick<SettingsCategory, 'assets' | 'strategies' | 'children'>,
): string | null => {
  const parts = [
    category.children > 0
      ? plural(category.children, 'categoria dentro', 'categorias dentro')
      : null,
    category.assets > 0 ? plural(category.assets, 'ativo', 'ativos') : null,
    category.strategies > 0
      ? plural(category.strategies, 'estratégia', 'estratégias')
      : null,
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? null : parts.join(' · ');
};

export const portfolioCount = (count: number): string =>
  plural(count, 'carteira', 'carteiras');

/* -------------------------------------------------------------------------- */
/* Alertas                                                                    */
/* -------------------------------------------------------------------------- */

type AlertCopy = { readonly label: string; readonly description: string };

/**
 * O vocabulário das regras, na ordem da prancha. O servidor guarda o `kind` e
 * não o texto: a lista cresce por cadastro, e frase de interface não é dado.
 * Regra que a tela não conhece aparece com o `kind` — e nunca some, porque
 * esconder uma regra ligada é pior do que mostrá-la sem tradução.
 */
export const ALERT_COPY: Readonly<Record<string, AlertCopy>> = {
  price_stale: {
    label: 'Preço atrasado',
    description: 'Fonte principal sem cotação de um ativo com posição',
  },
  price_missing: {
    label: 'Preço ausente',
    description: 'Nunca houve preço para o papel: a posição entra pelo custo',
  },
  payout_unconfirmed: {
    label: 'Provento não confirmado',
    description: 'Data de pagamento passou e o provento não foi marcado como recebido',
  },
  negative_cash: {
    label: 'Caixa negativo',
    description: 'Saldo de uma conta fixa abaixo de zero em qualquer data',
  },
  corporate_event_pending: {
    label: 'Evento corporativo',
    description:
      'Desdobramento, grupamento ou bonificação anunciado para ativo com posição',
  },
  uncategorized_asset: {
    label: 'Ativo sem categoria',
    description: 'Ativo novo não cumpre nenhuma regra de categoria',
  },
  backup_failed: {
    label: 'Backup falhou',
    description: 'Backup automático não concluído',
  },
  upcoming_maturity: {
    label: 'Vencimento próximo',
    description: 'Título de renda fixa vence dentro do prazo',
  },
  off_strategy: {
    label: 'Fora da estratégia',
    description: 'Categoria passa da tolerância definida na estratégia da carteira',
  },
  idle_cash: {
    label: 'Caixa parado',
    description: 'Saldo em conta sem render por mais tempo que o limite',
  },
  asset_concentration: {
    label: 'Concentração em um ativo',
    description: 'Ativo passa do peso máximo definido na estratégia',
  },
  issuer_concentration: {
    label: 'Concentração em um emissor',
    description: 'Soma por emissor passa do limite do patrimônio',
  },
  strategy_review: {
    label: 'Revisão da estratégia',
    description: 'Data de revisão definida na estratégia chega',
  },
  goal_behind: {
    label: 'Objetivo abaixo do ritmo',
    description: 'Aporte médio de 12 meses fica abaixo do necessário',
  },
};

export const alertCopy = (kind: string): AlertCopy =>
  ALERT_COPY[kind] ?? { label: kind, description: 'Regra sem descrição cadastrada' };

const numberField = (threshold: Record<string, unknown>, key: string): string | null => {
  const value = threshold[key];
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value;
  return null;
};

/**
 * O limite da regra, como a prancha o escreve: `3 dias`, `da carteira`, `—`.
 * Regra "da carteira" lê o limite de cada carteira, e a configuração global não
 * tem número para mostrar; limite que a tela não sabe ler vira traço.
 */
export const alertLimit = (
  rule: Pick<SettingsAlertRule, 'scope' | 'threshold'>,
): string => {
  if (rule.scope === 'per_portfolio') return 'da carteira';
  if (rule.threshold === null) return '—';

  const days = numberField(rule.threshold, 'days');
  const pct = numberField(rule.threshold, 'pct');

  const parts = [
    pct === null ? null : `${pct.replace('.', ',')}%`,
    days === null ? null : plural(Number(days), 'dia', 'dias'),
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? '—' : parts.join(' · ');
};

/** Regras na ordem da prancha; as que a tela não conhece vão para o fim, por nome. */
export const sortAlerts = (rules: readonly SettingsAlertRule[]): SettingsAlertRule[] => {
  const order = Object.keys(ALERT_COPY);
  const rank = (kind: string): number => {
    const index = order.indexOf(kind);
    return index === -1 ? order.length : index;
  };

  return [...rules].sort(
    (a, b) => rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind),
  );
};

/* -------------------------------------------------------------------------- */
/* Categorias                                                                 */
/* -------------------------------------------------------------------------- */

const B3_TYPE_LABEL: Readonly<Record<string, string>> = {
  stock: 'ação ou unit',
  fii: 'fundo imobiliário',
  etf: 'ETF',
  bdr: 'BDR',
  treasury: 'Tesouro',
  cash: 'saldo em conta',
};

const INDEXER_LABEL: Readonly<Record<string, string>> = {
  cdi_pct: 'CDI ou Selic',
  selic_plus: 'CDI ou Selic',
  ipca_plus: 'IPCA',
  prefixed: 'prefixado',
};

/**
 * A regra automática em palavras: `Tipo B3: ação ou unit`, `Indexador IPCA`.
 * As chaves que a regra pode olhar são fechadas (L-03), então o que não for
 * delas é descartado em vez de impresso cru.
 */
export const autoRuleText = (rule: Record<string, unknown> | null): string => {
  if (rule === null) return '—';

  const parts: string[] = [];
  const b3 = rule['b3_type'];
  const indexer = rule['indexer'];
  const origin = rule['origin'];
  const sector = rule['sector'];

  if (typeof b3 === 'string') parts.push(`Tipo B3: ${B3_TYPE_LABEL[b3] ?? b3}`);
  if (typeof indexer === 'string')
    parts.push(`Indexador ${INDEXER_LABEL[indexer] ?? indexer}`);
  if (origin === 'manual') parts.push('Cadastrado à mão');
  if (origin === 'market') parts.push('Da base de mercado');
  if (typeof sector === 'string') parts.push(`Setor: ${sector}`);

  return parts.length === 0 ? '—' : parts.join(' · ');
};

export type CategoryGroup = {
  readonly group: SettingsCategory;
  readonly children: readonly SettingsCategory[];
};

/** Grupos de topo, cada um com as categorias de dentro, na ordem do cadastro. */
export const groupCategories = (
  categories: readonly SettingsCategory[],
): CategoryGroup[] => {
  const bySort = (a: SettingsCategory, b: SettingsCategory): number =>
    a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'pt-BR');

  return categories
    .filter((category) => category.parent_id === null)
    .sort(bySort)
    .map((group) => ({
      group,
      children: categories
        .filter((category) => category.parent_id === group.id)
        .sort(bySort),
    }));
};

/* -------------------------------------------------------------------------- */
/* Instituições                                                               */
/* -------------------------------------------------------------------------- */

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
};

const KIND_LABEL: Readonly<Record<string, string>> = {
  quotes: 'Cotações',
  indices: 'Índices',
  treasury: 'Tesouro Direto',
  backfill: 'Histórico de ativo',
  cotahist: 'Carga inicial',
  contract_check: 'Verificação de formato',
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
  settings.portfolios.length === 0 &&
  settings.categories.length === 0 &&
  settings.institutions.length === 0;
