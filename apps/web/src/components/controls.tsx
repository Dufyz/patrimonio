import { Button, Chip, Label } from './primitives.js';

/**
 * D-06 · A barra de controles.
 *
 * Tudo nela tem a mesma altura e o mesmo espaçamento, e o estado inteiro mora
 * na URL — quem decide o que fazer com a mudança é a tela, que escreve a query.
 * A barra não guarda estado nenhum: é só a forma.
 */

export type AppliedFilter = {
  readonly id: string;
  readonly label: string;
  readonly onRemove: () => void;
};

export const Toolbar = ({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string | undefined;
}): React.ReactElement => (
  <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>{children}</div>
);

export const ControlGroup = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <div className="flex flex-col gap-1.5">
    <Label>{label}</Label>
    <Toolbar>{children}</Toolbar>
  </div>
);

/**
 * Os filtros aplicados, como etiquetas removíveis. "Limpar tudo" só aparece
 * quando há mais de um: com um filtro só, o × da própria etiqueta já faz isso,
 * e um botão a mais na barra é ruído.
 */
export const AppliedFilters = ({
  filters,
  onClearAll,
}: {
  readonly filters: readonly AppliedFilter[];
  readonly onClearAll: () => void;
}): React.ReactElement | null => {
  if (filters.length === 0) return null;

  return (
    <Toolbar>
      {filters.map((filter) => (
        <Chip key={filter.id} onRemove={filter.onRemove}>
          {filter.label}
        </Chip>
      ))}
      {filters.length > 1 ? (
        <Button variant="ghost" onClick={onClearAll}>
          Limpar tudo
        </Button>
      ) : null}
    </Toolbar>
  );
};

export type BenchmarkOption = {
  readonly id: string;
  readonly label: string;
  readonly colorToken?: string | undefined;
  /** O benchmark da carteira não pode ser desmarcado. */
  readonly locked?: boolean | undefined;
};

/** No máximo quatro linhas no gráfico, como a prancha 16 determina. */
export const MAX_BENCHMARKS = 4;

export const BenchmarkPicker = ({
  options,
  selected,
  onChange,
}: {
  readonly options: readonly BenchmarkOption[];
  readonly selected: readonly string[];
  readonly onChange: (selected: readonly string[]) => void;
}): React.ReactElement => {
  const atLimit = selected.length >= MAX_BENCHMARKS;

  return (
    <Toolbar>
      {options.map((option) => {
        const on = selected.includes(option.id);
        const blocked = (!on && atLimit) || (on && option.locked === true);

        return (
          <Chip
            key={option.id}
            selected={on}
            {...(option.colorToken === undefined
              ? {}
              : { colorToken: option.colorToken })}
            onClick={
              blocked
                ? undefined
                : () =>
                    onChange(
                      on
                        ? selected.filter((id) => id !== option.id)
                        : [...selected, option.id],
                    )
            }
          >
            {option.label}
          </Chip>
        );
      })}
    </Toolbar>
  );
};
