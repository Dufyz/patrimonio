import type { OverviewResource } from '@patrimonio/contracts';

import { CompositionBar } from '../components/bars.js';
import { Money, Percent } from '../components/number.js';
import { usePortfolios } from '../components/portfolios_provider.js';
import { percentAsRatio } from '../lib/overview.js';
import { colorForSeries } from '../lib/tokens.js';

/**
 * IVG-003 · Carteiras: todas as carteiras, com a do escopo atual em destaque, e
 * o total embaixo. A lista é a mesma nos dois escopos; só o destaque muda. A
 * cor de uma carteira é de série, e não de classe: uma carteira não é uma
 * classe de ativo, e emprestar o verde de Ações a ela faria a barra mentir.
 */
type Line = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly weight: string | null;
};

export const PortfoliosPanel = ({
  overview,
  onOpenPortfolio,
}: {
  readonly overview: OverviewResource;
  /** Abre a Visão geral da carteira. Ausente, o nome é só texto. */
  readonly onOpenPortfolio?: ((portfolioId: string) => void) | undefined;
}): React.ReactElement => {
  const shared = usePortfolios();
  const weights = new Map(overview.by_portfolio.map((row) => [row.portfolio_id, row]));
  const selected = overview.scope.portfolio_id;

  // O app lê a lista uma vez; sem ela (galeria, teste) vale a da própria resposta.
  const lines: readonly Line[] =
    shared.portfolios.length > 0
      ? shared.portfolios.map((portfolio) => ({
          id: portfolio.id,
          name: portfolio.name,
          value: shared.values[portfolio.id] ?? '0.00',
          weight: weights.get(portfolio.id)?.weight_pct ?? null,
        }))
      : overview.by_portfolio.map((row) => ({
          id: row.portfolio_id,
          name: row.name,
          value: row.value,
          weight: row.weight_pct,
        }));

  const total = shared.total ?? overview.totals.value;
  const withWeight = lines.some((line) => line.weight !== null);

  if (lines.length === 0) {
    return (
      <p className="p-4 text-[0.8125rem] text-ink-3">
        Nenhuma carteira consolidada até a data de referência.
      </p>
    );
  }

  return (
    <>
      {withWeight ? (
        <div className="px-4 pt-4 pb-1">
          <CompositionBar
            slices={lines.map((line, index) => ({
              id: line.id,
              label: line.name,
              colorToken: 'class.outros',
              color: colorForSeries(index),
              share: percentAsRatio(line.weight),
            }))}
            label="Distribuição por carteira"
          />
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[0.8125rem]">
          <caption className="sr-only">Valor de cada carteira</caption>
          <thead>
            <tr className="tabular text-label font-medium tracking-[0.06em] text-ink-3 uppercase">
              <th scope="col" className="px-4 py-[9px] text-left font-medium">
                Carteira
              </th>
              <th scope="col" className="px-4 py-[9px] text-right font-medium">
                Valor
              </th>
              {withWeight ? (
                <th scope="col" className="px-4 py-[9px] text-right font-medium">
                  Peso
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr
                key={line.id}
                aria-current={line.id === selected ? 'true' : undefined}
                className={`h-(--row-height) border-t border-line ${
                  line.id === selected ? 'bg-panel-2 font-medium' : ''
                }`}
              >
                <th scope="row" className="px-4 text-left font-[inherit]">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-xs"
                      style={{ backgroundColor: colorForSeries(index) }}
                    />
                    {onOpenPortfolio === undefined ? (
                      line.name
                    ) : (
                      <button
                        type="button"
                        className="cursor-pointer hover:text-accent"
                        onClick={() => onOpenPortfolio(line.id)}
                      >
                        {line.name}
                      </button>
                    )}
                  </span>
                </th>
                <td className="px-4 text-right">
                  <Money value={line.value} />
                </td>
                {withWeight ? (
                  <td className="px-4 text-right">
                    <Percent value={percentAsRatio(line.weight)} decimals={1} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="h-(--row-height) border-t border-line-strong font-medium">
              <th scope="row" className="px-4 text-left font-[inherit]">
                Total
              </th>
              <td className="px-4 text-right">
                <Money value={total} />
              </td>
              {withWeight ? <td /> : null}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
};
