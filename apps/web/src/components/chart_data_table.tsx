import type { DateOnly } from '@patrimonio/domain';

import { Money, Percent } from './number.js';

/**
 * CMP-07 · A alternativa em tabela de todo gráfico: os mesmos valores da dica,
 * em linhas que o leitor de tela percorre e que o teclado alcança. Valor ausente
 * é traço, nunca zero. O botão de olho mascara os números aqui como no gráfico,
 * porque `Money` e `Percent` já o respeitam.
 */
export type ChartTableColumn = {
  readonly id: string;
  readonly label: string;
  readonly values: readonly (string | null)[];
};

const MAX_ROWS = 24;

const sampled = (length: number): readonly number[] => {
  if (length <= MAX_ROWS) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (MAX_ROWS - 1);
  return Array.from({ length: MAX_ROWS }, (_, index) => Math.round(index * step));
};

export const ChartDataTable = ({
  caption,
  rowLabels,
  columns,
  format,
}: {
  readonly caption: string;
  readonly rowLabels: readonly (DateOnly | string)[];
  readonly columns: readonly ChartTableColumn[];
  readonly format: 'money' | 'percent';
}): React.ReactElement => (
  <div
    className="sr-only focus-within:not-sr-only focus-within:max-h-48 focus-within:overflow-y-auto"
    // O quadro aparece quando o teclado entra nele; fora disso só o leitor de tela o lê.
  >
    <table tabIndex={0} aria-label={caption} className="text-cell">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Data</th>
          {columns.map((column) => (
            <th key={column.id} scope="col">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sampled(rowLabels.length).map((index) => (
          <tr key={index}>
            <th scope="row">{rowLabels[index]}</th>
            {columns.map((column) => {
              const value = column.values[index] ?? null;
              return (
                <td key={column.id}>
                  {value === null ? (
                    '—'
                  ) : format === 'money' ? (
                    <Money value={value} />
                  ) : (
                    <Percent value={value} signed />
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
