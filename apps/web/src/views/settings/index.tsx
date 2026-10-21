import type { MarketHealth, Settings } from '@patrimonio/contracts';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchMarketHealth } from '../../api/market.js';
import { fetchSettings } from '../../api/settings.js';
import { Icon } from '../../components/icon.js';
import { KeepPrevious } from '../../components/pending.js';
import {
  SkeletonHeader,
  SkeletonLines,
  SkeletonPanel,
  SkeletonRegion,
  SkeletonTable,
} from '../../components/skeleton.js';
import { SearchInput } from '../../components/primitives.js';
import {
  DEFAULT_SECTION,
  isEmptyInstallation,
  marketSummary,
  matchSections,
  sectionFromParam,
} from '../../lib/settings.js';
import type { SectionId } from '../../lib/settings.js';
import type { Resource } from '../../lib/use_resource.js';
import { useResource } from '../../lib/use_resource.js';
import { MarketSection } from './market.js';
import { BackupSection, DisplaySection } from './preferences.js';
import { PortfoliosSection } from './registers.js';

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
  const [params, setParams] = useSearchParams();
  const section = sectionFromParam(params.get('secao'));

  const settings = useResource((signal) => fetchSettings(signal), []);
  const market = useResource((signal) => fetchMarketHealth(signal), []);

  const onSection = useCallback(
    (next: SectionId) =>
      setParams(
        (current) => {
          const search = new URLSearchParams(current);
          if (next === DEFAULT_SECTION) search.delete('secao');
          else search.set('secao', next);
          return search;
        },
        { replace: true },
      ),
    [setParams],
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

const Failed = ({
  error,
  onRetry,
}: {
  readonly error: Error;
  readonly onRetry: () => void;
}): React.ReactElement => (
  <section
    role="alert"
    className="rounded-panel border border-line bg-panel p-8 text-center"
  >
    <h2 className="text-panel-title font-semibold text-negative">
      A tela não pôde ser carregada
    </h2>
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      {error.message}
    </p>
    <button
      type="button"
      className="mt-4 h-control cursor-pointer rounded-control border border-line px-3 text-[0.8125rem] hover:bg-panel-2"
      onClick={onRetry}
    >
      Tentar de novo
    </button>
  </section>
);

const SectionNav = ({
  section,
  onSection,
  attention,
}: {
  readonly section: SectionId;
  readonly onSection: (section: SectionId) => void;
  /** Seções com algo a ver: ganham um ponto, como "Dados de mercado" na prancha. */
  readonly attention: ReadonlySet<SectionId>;
}): React.ReactElement => {
  const [query, setQuery] = useState('');
  const matches = matchSections(query);
  const groups = [...new Set(matches.map((item) => item.group))];

  return (
    <nav
      aria-label="Seções de configuração"
      className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start"
    >
      <header className="min-w-0">
        <h1 className="text-screen-title leading-7 font-semibold">Configurações</h1>
        <p className="text-xs text-ink-3">Valem para o app inteiro</p>
      </header>
      <SearchInput
        label="Buscar ajuste"
        placeholder="Buscar ajuste"
        value={query}
        onChange={setQuery}
      />
      {matches.length === 0 ? (
        <p className="px-1 text-[0.8125rem] text-ink-3">Nenhum ajuste com esse nome.</p>
      ) : (
        groups.map((group) => (
          <div key={group}>
            <p className="mb-1 px-3 tabular text-label font-medium tracking-[0.06em] text-ink-3 uppercase">
              {group}
            </p>
            <ul className="flex flex-wrap gap-1 lg:flex-col">
              {matches
                .filter((item) => item.group === group)
                .map((item) => (
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
          </div>
        ))
      )}
      <p className="hidden border-t border-line px-3 pt-3 text-xs text-ink-3 lg:block">
        Patrimônio · versão pessoal
        <br />
        Dados armazenados na sua conta
      </p>
    </nav>
  );
};

export const SettingsView = ({
  settings: resource,
  market,
  section,
  onSection,
}: SettingsViewProps): React.ReactElement => {
  const { state, pending, reload } = resource;

  // A seção da URL é onde a tela abre: a âncora existe só depois de os painéis
  // serem desenhados, então o salto espera a leitura terminar.
  const ready = state.kind === 'ready';
  useEffect(() => {
    if (!ready) return;
    const element = globalThis.document.getElementById(`secao-${section}`);
    // jsdom não implementa `scrollIntoView`; no navegador ele existe sempre.
    if (typeof element?.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'start' });
    }
  }, [ready, section]);

  if (state.kind === 'loading') {
    return (
      <SkeletonRegion label="Carregando as configurações" className="flex flex-col gap-4">
        <SkeletonHeader />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[14rem_1fr]">
          <SkeletonLines lines={5} className="hidden lg:flex" />
          <div className="flex min-w-0 flex-col gap-4">
            <SkeletonPanel title="Carteiras">
              <SkeletonTable rows={3} columns={3} />
            </SkeletonPanel>
            <SkeletonPanel title="Dados de mercado" />
            <SkeletonPanel title="Exibição" />
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
      attention.add('mercado');
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <SectionNav section={section} onSection={onSection} attention={attention} />

      <KeepPrevious
        pending={pending}
        className="flex max-w-[60rem] min-w-0 flex-col gap-8"
      >
        {isEmptyInstallation(settings) ? (
          <p
            role="status"
            className="rounded-panel border border-line bg-panel p-4 text-[0.8125rem] text-ink-2"
          >
            Nada cadastrado ainda. Comece criando uma carteira — o resto das configurações
            já está abaixo.
          </p>
        ) : null}
        <DisplaySection />
        <PortfoliosSection settings={settings} onChanged={reload} />
        <MarketSection resource={market} />
        <BackupSection settings={settings} onChanged={reload} />
      </KeepPrevious>
    </div>
  );
};
