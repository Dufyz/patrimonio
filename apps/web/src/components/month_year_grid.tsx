import { intensityScale, legendSteps } from '../lib/chart/intensity.js';
import { intensityColor } from '../lib/tokens.js';
import { Money, Percent } from './number.js';

/**
 * D-09 · A grade de mês contra ano.
 *
 * Serve a duas perguntas com a mesma forma: quanto rendeu cada mês e quanto
 * entrou de provento em cada mês. A cor dá o padrão de relance — qual ano foi
 * bom, em que meses costuma cair —, mas o número exato continua legível dentro
 * da célula: a cor é a camada rápida, não a informação.
 *
 * Clicar em uma célula leva aos lançamentos daquele mês, porque a pergunta que
 * vem logo depois de "por que agosto foi assim?" é "o que aconteceu em agosto?".
 */

export const MONTH_INITIALS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

export type GridYear = {
  readonly year: number;
  /** Doze posições; `null` em mês sem dado — que não é mês de valor zero. */
  readonly months: readonly (string | null)[];
  readonly total: string | null;
  /** Colunas extras à direita, como o benchmark do ano na prancha 08. */
  readonly extras?: readonly (string | null)[] | undefined;
  readonly partial?: boolean | undefined;
};

export type MonthYearGridProps = {
  readonly years: readonly GridYear[];
  /** `percent` para retorno mensal, `money` para provento recebido. */
  readonly format: 'percent' | 'money';
  readonly totalHeader?: string;
  readonly extraHeaders?: readonly string[] | undefined;
  /** Média por mês, quando a `api` a calcula. */
  readonly averages?: readonly (string | null)[] | undefined;
  readonly onSelectMonth?: ((year: number, month: number) => void) | undefined;
  readonly caption: string;
};

const CellValue = ({
  value,
  format,
}: {
  readonly value: string | null;
  readonly format: 'percent' | 'money';
}): React.ReactElement =>
  format === 'percent' ? (
    <Percent value={value} decimals={2} signed />
  ) : (
    <Money value={value} />
  );

export const MonthYearGrid = ({
  years,
  format,
  totalHeader = 'Ano',
  extraHeaders = [],
  averages,
  onSelectMonth,
  caption,
}: MonthYearGridProps): React.ReactElement => {
  const scale = intensityScale(years.flatMap((year) => year.months));

  return (
    <div className="flex flex-col gap-2">
      <table className="w-full table-fixed border-collapse text-cell">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line">
            <th
              scope="col"
              className="w-20 px-2 pb-2 text-left text-label tracking-wide text-ink-3 uppercase"
            >
              Ano
            </th>
            {MONTH_INITIALS.map((month) => (
              <th
                key={month}
                scope="col"
                className="px-1 pb-2 text-center text-label tracking-wide text-ink-3 uppercase"
              >
                {month}
              </th>
            ))}
            <th
              scope="col"
              className="w-24 border-l border-line px-2 pb-2 text-right text-label tracking-wide text-ink-3 uppercase"
            >
              {totalHeader}
            </th>
            {extraHeaders.map((header) => (
              <th
                key={header}
                scope="col"
                className="w-24 px-2 pb-2 text-right text-label tracking-wide text-ink-3 uppercase"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {years.map((year) => (
            <tr key={year.year}>
              <th scope="row" className="px-2 text-left font-semibold">
                {year.year}
                {year.partial === true ? (
                  <span className="ml-1 text-label font-normal text-ink-3">YTD</span>
                ) : null}
              </th>

              {MONTH_INITIALS.map((month, index) => {
                const value = year.months[index] ?? null;
                const content =
                  value === null ? (
                    <span className="text-ink-3">·</span>
                  ) : (
                    <CellValue value={value} format={format} />
                  );

                return (
                  <td key={month} className="p-0.5">
                    {value === null || onSelectMonth === undefined ? (
                      <span
                        className="flex h-8 items-center justify-center rounded-xs"
                        style={{ backgroundColor: intensityColor(scale.of(value)) }}
                      >
                        {content}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="flex h-8 w-full cursor-pointer items-center justify-center rounded-xs hover:ring-1 hover:ring-accent"
                        style={{ backgroundColor: intensityColor(scale.of(value)) }}
                        onClick={() => onSelectMonth(year.year, index + 1)}
                      >
                        {content}
                      </button>
                    )}
                  </td>
                );
              })}

              <td className="border-l border-line px-2 text-right font-semibold">
                <CellValue value={year.total} format={format} />
              </td>
              {extraHeaders.map((header, index) => (
                <td key={header} className="px-2 text-right text-ink-2">
                  <CellValue value={year.extras?.[index] ?? null} format={format} />
                </td>
              ))}
            </tr>
          ))}

          {averages === undefined ? null : (
            <tr className="border-t border-line">
              <th scope="row" className="px-2 text-left text-ink-2">
                Média
              </th>
              {MONTH_INITIALS.map((month, index) => (
                <td key={month} className="px-1 text-center text-ink-2">
                  <CellValue value={averages[index] ?? null} format={format} />
                </td>
              ))}
              <td className="border-l border-line px-2" />
              {extraHeaders.map((header) => (
                <td key={header} />
              ))}
            </tr>
          )}
        </tbody>
      </table>

      <IntensityLegend scale={scale} format={format} />
    </div>
  );
};

/**
 * A legenda da escala. Sem ela a cor vira decoração: quem olha não tem como
 * saber se o verde mais forte é 2% ou 20%.
 */
const IntensityLegend = ({
  scale,
  format,
}: {
  readonly scale: ReturnType<typeof intensityScale>;
  readonly format: 'percent' | 'money';
}): React.ReactElement => (
  <div className="flex items-center justify-end gap-2 text-label text-ink-3">
    <CellValue value={String(-scale.extent)} format={format} />
    {legendSteps(scale).map((step) => (
      <span
        key={step}
        aria-hidden="true"
        className="inline-block h-3 w-6 rounded-xs border border-line"
        style={{ backgroundColor: intensityColor(step) }}
      />
    ))}
    <CellValue value={String(scale.extent)} format={format} />
  </div>
);
