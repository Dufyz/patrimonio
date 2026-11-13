import { useInRouterContext, useNavigate } from 'react-router';

import { routes } from '../lib/routes.js';
import type { HomeScope } from '../lib/routes.js';
import { ALL_SCOPE } from '../lib/scope.js';
import { usePortfolios } from './portfolios_provider.js';
import { Segmented } from './primitives.js';

/**
 * VGR-01 · O escopo da Visão geral: Tudo, Fluxo ou Investimentos. É o único
 * controle segmentado do app, e escreve `escopo` na URL. Em Investimentos, o
 * seletor de carteira escreve o mesmo parâmetro `carteira` da barra lateral.
 */
const OPTIONS = [
  { value: 'tudo', label: 'Tudo' },
  { value: 'fluxo', label: 'Fluxo' },
  { value: 'investimentos', label: 'Investimentos' },
] as const;

const ScopeControl = ({
  scope,
  portfolioId = null,
}: {
  readonly scope: HomeScope;
  /** A carteira escolhida; `null` é Todas. Só vale em Investimentos. */
  readonly portfolioId?: string | null;
}): React.ReactElement => {
  const navigate = useNavigate();
  const { portfolios, slugs } = usePortfolios();
  const portfolio =
    portfolioId === null ? ALL_SCOPE : (slugs.get(portfolioId) ?? ALL_SCOPE);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Escopo da Visão geral"
        options={OPTIONS}
        value={scope}
        onChange={(next) => {
          void navigate(
            routes.home(next, next === 'investimentos' ? portfolio : undefined),
          );
        }}
      />
      {scope === 'investimentos' ? (
        <select
          aria-label="Carteira"
          className="h-control cursor-pointer rounded-control border border-line bg-panel px-2 text-[0.8125rem]"
          value={portfolio}
          onChange={(event) => {
            void navigate(routes.home('investimentos', event.target.value));
          }}
        >
          <option value={ALL_SCOPE}>Todas as carteiras</option>
          {portfolios.map((item) => (
            <option key={item.id} value={slugs.get(item.id) ?? item.id}>
              {item.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
};

/** Fora de um roteador (galeria, testes de painel) o controle não tem para onde navegar. */
export const HomeScopeControl = (
  props: React.ComponentProps<typeof ScopeControl>,
): React.ReactElement | null =>
  useInRouterContext() ? <ScopeControl {...props} /> : null;
