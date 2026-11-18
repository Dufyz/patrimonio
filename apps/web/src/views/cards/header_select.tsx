import { SearchSelect } from '../../components/search_select.js';

/**
 * O seletor do cabeçalho de Cartões, como nas pranchas 4.1 a 4.3: o seletor
 * padrão da barra (ícone, rótulo e a escolha atual), com o valor de cada
 * opção à direita. A escolha troca só esta tela.
 */
export type HeaderOption = {
  readonly id: string;
  readonly label: string;
  /** Já formatado, respeitando "ocultar valores". */
  readonly amount: string;
};

export const HeaderSelect = ({
  label,
  options,
  selected,
  footer,
  onSelect,
}: {
  readonly label: string;
  readonly current: string;
  readonly options: readonly HeaderOption[];
  readonly selected: string;
  readonly footer: string;
  readonly onSelect: (id: string) => void;
}): React.ReactElement => (
  <SearchSelect
    label={label}
    toolbar={{ icon: 'card' }}
    options={options.map((option) => ({
      id: option.id,
      label: option.label,
      value: option.amount,
    }))}
    value={selected}
    note={footer}
    onChange={onSelect}
  />
);
