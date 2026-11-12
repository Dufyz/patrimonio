import { Button } from '../../components/primitives.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { ENTRY_GROUPINGS } from '../lib/preferences.js';
import type { EntryGrouping } from '../lib/preferences.js';

/** FIN-304 · "Agrupar: Dia": o seletor de agrupamento da tabela de lançamentos. */

export const GROUPING_LABELS: Readonly<Record<EntryGrouping, string>> = {
  dia: 'Dia',
  tipo: 'Tipo',
  categoria: 'Categoria',
  conta: 'Conta',
};

/** O que o subtítulo da tela diz de cada agrupamento. */
export const GROUPING_SUBTITLES: Readonly<Record<EntryGrouping, string>> = {
  dia: 'por dia, do mais recente ao mais antigo',
  tipo: 'receitas e despesas',
  categoria: 'por categoria',
  conta: 'por conta',
};

export const GroupSelector = <T extends EntryGrouping = EntryGrouping>({
  value,
  onChange,
  options = ENTRY_GROUPINGS as readonly EntryGrouping[] as readonly T[],
}: {
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Quais agrupamentos a tela oferece; por padrão, os de Lançamentos. */
  readonly options?: readonly T[];
}): React.ReactElement => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button icon="list" aria-label={`Agrupar: ${GROUPING_LABELS[value]}`}>
        Agrupar: {GROUPING_LABELS[value]}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="min-w-40">
      {options.map((grouping) => (
        <DropdownMenuItem
          key={grouping}
          aria-checked={grouping === value}
          onSelect={() => onChange(grouping)}
        >
          {GROUPING_LABELS[grouping]}
          {grouping === value ? <span aria-hidden="true">✓</span> : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);
