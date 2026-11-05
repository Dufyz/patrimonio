import { Icon } from './icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.js';

/**
 * FIN-001 · O seletor de área.
 *
 * O topo da barra lateral mostra só o nome da área e a seta do seletor: não há
 * logotipo nem ícone da plataforma, porque ainda não existe identidade visual.
 * Cada área tem a sua navegação, e trocar de área abre a tela inicial dela.
 */

export const AREAS = ['investimentos', 'financas'] as const;
export type AreaId = (typeof AREAS)[number];

export const AREA_LABELS: Readonly<Record<AreaId, string>> = {
  financas: 'Finanças',
  investimentos: 'Investimentos',
};

export const AreaSwitcher = ({
  current,
  onSelect,
}: {
  readonly current: AreaId;
  readonly onSelect: (area: AreaId) => void;
}): React.ReactElement => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={`Área: ${AREA_LABELS[current]}. Trocar de área`}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control px-0 text-[0.9375rem] font-semibold tracking-[-0.01em] outline-none hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-focus/40 data-[state=open]:bg-panel-2"
      >
        {AREA_LABELS[current]}
        <span aria-hidden="true" className="text-ink-3">
          <Icon name="chevron-down" />
        </span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent aria-label="Áreas" align="start" className="min-w-[200px]">
      {AREAS.map((area) => (
        <DropdownMenuItem
          key={area}
          aria-current={area === current ? 'true' : undefined}
          onSelect={() => {
            if (area !== current) onSelect(area);
          }}
        >
          <span>{AREA_LABELS[area]}</span>
          {area === current ? (
            <span aria-hidden="true" className="text-accent">
              <Icon name="check" />
            </span>
          ) : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);
