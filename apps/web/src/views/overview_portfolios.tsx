import type { OverviewResource, PerformanceResource } from '@patrimonio/contracts';

import { CompositionBar } from '../components/bars.js';
import { Money, Percent } from '../components/number.js';
import { colorForSeries } from '../lib/tokens.js';
import { percentAsRatio } from '../lib/overview.js';
import { windowLabel } from '../lib/performance.js';

const RETURN_KEYS = ['month', 'ytd', '12m', 'inception'] as const;

/**
 * "Quanto eu tenho em cada carteira" — o painel que só existe em Todas as
 * carteiras. A barra e a tabela leem a mesma lista: a cor de uma carteira é a
 * mesma nas duas, e o peso que a barra desenha é o que a coluna escreve.
 *
 * O retorno de cada carteira é o da cota dela, na mesma janela das classes:
 * a soma não tem cota, e esta é a leitura que ela esconde.
 *
 * As cores são as de série, e não as de classe: uma carteira não é uma classe
 * de ativo, e emprestar o verde de Ações a ela faria a barra mentir.
 */
export const PortfoliosTable = ({
  overview,
  performance,
  onOpenPortfolio,
}: {
  readonly overview: OverviewResource;
  /** Ausente enquanto carrega ou quando falha: o retorno vira traço. */
  readonly performance: PerformanceResource | null;
  /** Abre a Visão geral da carteira. Ausente, o nome é só texto. */
  readonly onOpenPortfolio?: ((portfolioId: string) => void) | undefined;
}): React.ReactElement => {
  const rows = overview.by_portfolio;
  const returns = new Map(
    (performance?.breakdown.portfolios ?? []).map((row) => [row.portfolio_id, row]),
  );
  const labelContext = {
    referenceDate: overview.reference_date,
    inception: overview.scope.inception,
  };

  if (rows.length === 0) {
    return (
      <p className="p-4 text-[0.8125rem] text-ink-3">
        Nenhuma carteira consolidada até a data de referência.
      </p>
    );
  }

  return (
    <>
      <div className="px-4 pt-4 pb-1">
        <CompositionBar
          slices={rows.map((row, index) => ({
            id: row.portfolio_id,
            label: row.name,
            colorToken: 'class.outros',
            color: colorForSeries(index),
            share: percentAsRatio(row.weight_pct),
          }))}
          label="Distribuição por carteira"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-160 border-collapse text-[0.8125rem]">
          <caption className="sr-only">Valor, peso e retorno de cada carteira</caption>
          <thead>
            <tr className="tabular text-label font-medium tracking-[0.06em] text-ink-3 uppercase">
              <th scope="col" className="px-4 py-[9px] text-left font-medium">
                Carteira
              </th>
              <th scope="col" className="px-4 py-[9px] text-right font-medium">
                Valor
              </th>
              <th scope="col" className="px-4 py-[9px] text-right font-medium">
                Peso
              </th>
              {RETURN_KEYS.map((key) => (
                <th
                  key={key}
                  scope="col"
                  className="px-4 py-[9px] text-right font-medium"
                >
                  {windowLabel(key, labelContext)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.portfolio_id}
                className="h-(--row-height) border-t border-line"
              >
                <th scope="row" className="px-4 text-left font-normal">
                  <span className="flex items-center gap-2">
                    {/* O mesmo recuo da seta das classes: os nomes alinham. */}
                    <span aria-hidden="true" className="w-3.5 shrink-0" />
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-xs"
                      style={{ backgroundColor: colorForSeries(index) }}
                    />
                    {onOpenPortfolio === undefined ? (
                      row.name
                    ) : (
                      <button
                        type="button"
                        className="cursor-pointer hover:text-accent"
                        onClick={() => onOpenPortfolio(row.portfolio_id)}
                      >
                        {row.name}
                      </button>
                    )}
                  </span>
                </th>
                <td className="px-4 text-right">
                  <Money value={row.value} />
                </td>
                <td className="px-4 text-right">
                  <Percent value={percentAsRatio(row.weight_pct)} decimals={1} />
                </td>
                {RETURN_KEYS.map((key, column) => (
                  <td key={key} className="px-4 text-right">
                    <Percent
                      value={percentAsRatio(
                        returns.get(row.portfolio_id)?.returns[column] ?? null,
                      )}
                      decimals={2}
                      signed
                      tone="signed"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};
