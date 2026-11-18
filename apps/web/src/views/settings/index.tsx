import type { MarketHealth, Settings } from '@patrimonio/contracts';
import { SearchSelect } from '../../components/search_select.js';
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { fetchAccounts } from '../../api/accounts.js';
import { fetchMarketHealth } from '../../api/market.js';
import { fetchSettings } from '../../api/settings.js';
import { Icon } from '../../components/icon.js';
import { KeepPrevious } from '../../components/pending.js';
import {
  SkeletonLines,
  SkeletonPanel,
  SkeletonRegion,
  SkeletonTable,
} from '../../components/skeleton.js';
import {
  isEmptyInstallation,
  marketSummary,
  SECTIONS,
  sectionFromParam,
} from '../../lib/settings.js';
import { settingsPath } from '../../lib/settings.js';
import type { SectionId } from '../../lib/settings.js';
import type { Resource } from '../../lib/use_resource.js';
import { useResource } from '../../lib/use_resource.js';
import { MarketSection } from './market.js';
import { BackupSection, DisplaySection } from './preferences.js';
import { PortfoliosSection } from './registers.js';
import { AccountsCardsSection } from './accounts_cards.js';
import { ScreenFailed } from '../../components/panel_state.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { NewEntryModal } from '../ledger/new_entry_modal.js';

/**
 * T-08 · Configurações — a prancha `11 · Configurações`.
 *
 * Nove painéis numa rolagem só, na ordem da prancha, e uma navegação ao lado que
 * leva a cada um. Cada painel resolve uma coisa, e nenhum faz conta: contagem,
 * soma e percentual chegam da `api`, que também diz o que impede cada exclusão —
 * o bloqueio chega explicado, e não como um erro depois do clique.
 *
 * Duas leituras, e não uma: `/settings` traz os cadastros; `/market/health` traz
 * a situação das fontes, que muda sozinha enquanto uma coleta roda e por isso
 * tem a releitura dela. A seção atual vive na URL (`secao`), e o padrão nunca é
 * escrito.
 */

export type SettingsViewProps = {
  readonly settings: Resource<Settings>;
  readonly market: Resource<MarketHealth>;
  readonly section: SectionId;
  readonly onSection: (section: SectionId) => void;
};

export const SettingsScreen = (): React.ReactElement => {
  const { section: param } = useParams();
  const navigate = useNavigate();
  const section = sectionFromParam(param);

  const settings = useResource((signal) => fetchSettings(signal), []);
  const market = useResource((signal) => fetchMarketHealth(signal), []);

  const onSection = useCallback(
    (next: SectionId) => void navigate(settingsPath(next)),
    [navigate],
  );

  return (
    <SettingsView
      settings={settings}
      market={market}
      section={section}
      onSection={onSection}
    />
  );
};

const Failed = ScreenFailed;

/** O subtítulo de cada seção, como na prancha 11. */
const SUBTITLES: Readonly<Record<SectionId, string>> = {
  exibicao: 'Aparência e comportamento do app · valem só para este navegador',
  'contas-e-cartoes':
    'Cadastro das contas e dos cartões · saldos e faturas ficam em Contas e Cartões',
  carteiras: 'Criar, ordenar e arquivar carteiras',
  'dados-de-mercado': 'Catálogos, fontes de preço e cotações manuais',
  'dados-e-backup': 'Exportação, backup e apagamento',
};

/** O menu da prancha: um cartão ao lado do conteúdo, sem títulos de grupo. */
const SectionNav = ({
  section,
  onSection,
  attention,
}: {
  readonly section: SectionId;
  readonly onSection: (section: SectionId) => void;
  /** Seções com algo a ver: ganham um ponto, como "Dados de mercado" na prancha. */
  readonly attention: ReadonlySet<SectionId>;
}): React.ReactElement => (
  <nav
    aria-label="Seções de configuração"
    className="shrink-0 rounded-panel border border-line bg-panel p-2 shadow-panel lg:w-60"
  >
    {/* CFG-07 · Abaixo de 1.000 px o menu vira um seletor no topo. */}
    <div className="lg:hidden">
      <SearchSelect
        label="Seção de configuração"
        options={SECTIONS.map((item) => ({ id: item.id, label: item.label }))}
        value={section}
        onChange={(id) => onSection(id as SectionId)}
      />
    </div>
    <ul
      className="flex flex-col gap-0.5 max-lg:hidden"
      onKeyDown={(event) => {
        // Setas percorrem o menu, de cima a baixo.
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
        ];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        if (at === -1) return;
        event.preventDefault();
        items[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
      }}
    >
      {SECTIONS.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            aria-current={item.id === section ? 'true' : undefined}
            className={`flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-control px-3 text-left text-sm whitespace-nowrap ${
              item.id === section
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-ink-2 hover:bg-panel-2'
            }`}
            onClick={() => onSection(item.id)}
          >
            <Icon name={item.icon} />
            <span className="flex-1">{item.label}</span>
            {attention.has(item.id) ? (
              <span
                role="img"
                aria-label="pede atenção"
                className="size-1.5 rounded-full bg-attention"
              />
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  </nav>
);

export const SettingsView = ({
  settings: resource,
  market,
  section,
  onSection,
}: SettingsViewProps): React.ReactElement => {
  const { state, pending, reload } = resource;
  const [entering, setEntering] = useState(false);
  const accounts = useResource((signal) => fetchAccounts(false, signal), []);

  const header = (
    <ScreenHeader
      title="Configurações"
      subtitle={SUBTITLES[section]}
      primary={{ label: 'Movimentação', onClick: () => setEntering(true) }}
    />
  );

  if (state.kind === 'loading') {
    return (
      <SkeletonRegion label="Carregando as configurações">
        {header}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="shrink-0 rounded-panel border border-line bg-panel p-4 lg:w-60">
            <SkeletonLines lines={5} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <SkeletonPanel title="Carteiras">
              <SkeletonTable rows={3} columns={3} />
            </SkeletonPanel>
            <SkeletonPanel title="Dados de mercado" />
          </div>
        </div>
      </SkeletonRegion>
    );
  }
  if (state.kind === 'error') return <Failed error={state.error} onRetry={reload} />;

  const settings = state.value;

  const attention = new Set<SectionId>();
  if (market.state.kind === 'ready') {
    const summary = marketSummary(market.state.value);
    if (summary.warnings > 0 || market.state.value.missing_prices.length > 0) {
      attention.add('dados-de-mercado');
    }
  }

  return (
    <div>
      {header}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <SectionNav section={section} onSection={onSection} attention={attention} />

        <KeepPrevious pending={pending} className="flex min-w-0 flex-1 flex-col gap-4">
          {isEmptyInstallation(settings) ? (
            <p
              role="status"
              className="rounded-panel border border-line bg-panel p-4 text-[0.8125rem] text-ink-2"
            >
              Nada cadastrado ainda. Comece criando uma carteira — o resto das
              configurações já está abaixo.
            </p>
          ) : null}
          {section === 'exibicao' ? <DisplaySection /> : null}
          {section === 'contas-e-cartoes' ? <AccountsCardsSection /> : null}
          {section === 'carteiras' ? (
            <PortfoliosSection settings={settings} onChanged={reload} />
          ) : null}
          {section === 'dados-de-mercado' ? <MarketSection resource={market} /> : null}
          {section === 'dados-e-backup' ? (
            <BackupSection settings={settings} onChanged={reload} />
          ) : null}
        </KeepPrevious>
      </div>
      {entering ? (
        <NewEntryModal
          today={
            accounts.state.kind === 'ready'
              ? accounts.state.value.as_of
              : new Date().toISOString().slice(0, 10)
          }
          accounts={
            accounts.state.kind === 'ready'
              ? accounts.state.value.accounts.map((row) => ({
                  id: row.account.id,
                  name: row.account.name,
                }))
              : []
          }
          onSaved={reload}
          onClose={() => setEntering(false)}
        />
      ) : null}
    </div>
  );
};
