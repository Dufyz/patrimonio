import type { OverviewResource } from '@patrimonio/contracts';
import { Link } from 'react-router';

import { Money, Percent } from '../../components/number.js';
import { Panel, PriceHealthDot } from '../../components/primitives.js';
import { FinTable, Th, THead } from '../../components/table_parts.js';
import { assetSlug, assetTitle } from '../../lib/asset_page.js';
import { percentAsRatio } from '../../lib/overview.js';
import { PanelHeaderAction } from '../../finance/components/overview_panels.js';
import { centsToDecimal } from '../../finance/lib/money.js';
import { TOTAL_LINK_LABEL } from '../../lib/total_links.js';
import { WeightBar } from './alocacao_panel.js';

/**
 * VGR-09 · Maiores posições, na forma das pranchas 1.3 e 1.4: Ativo, Valor e
 * Peso (número e barra), com "Todas" ao lado do título e, à direita, quantas
 * aparecem do total.
 */
export const PosicoesPanel = ({
  overview,
  allHref,
  assetHref,
}: {
  readonly overview: OverviewResource;
  readonly allHref: string;
  readonly assetHref?: ((slug: string) => string) | undefined;
}): React.ReactElement => {
  const { total_count: total } = overview.top_positions;
  // A prancha mostra as cinco maiores; o resto fica em Posições ("Todas").
  const rows = overview.top_positions.rows.slice(0, 5);
  // A linha de total soma as que aparecem, como o total do card de alocação.
  const shownCents = rows.reduce(
    (acc, row) => acc + Math.round(Number(row.value) * 100),
    0,
  );
  const shownValue = centsToDecimal(shownCents);
  const shownWeight = rows
    .reduce((acc, row) => acc + Number(row.weight_pct ?? 0), 0)
    .toFixed(4);

  return (
    <Panel
      title="Maiores posições"
      action={
        <PanelHeaderAction
          hint={
            rows.length < total
              ? `${rows.length} de ${total} no total`
              : `${total} no total`
          }
          more={{ to: allHref, label: 'Todas' }}
        />
      }
      className="flex flex-col"
    >
      {rows.length === 0 ? (
        <p className="p-4 text-[0.8125rem] text-ink-3">
          Nenhuma posição aberta. A primeira movimentação começa a história da carteira.
        </p>
      ) : (
        <FinTable caption="Maiores posições" fill>
          <THead>
            <Th>Ativo</Th>
            <Th align="right">Valor</Th>
            <Th align="right">Peso</Th>
          </THead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.asset_id} className="border-t border-line">
                <th
                  scope="row"
                  className="truncate py-[var(--row-pad)] pl-3 text-left font-medium"
                >
                  <span className="flex items-center gap-2">
                    {assetHref === undefined ? (
                      <span title={row.name}>{assetTitle(row)}</span>
                    ) : (
                      <Link
                        to={assetHref(assetSlug(row))}
                        title={row.name}
                        className="cursor-pointer hover:text-accent hover:underline"
                      >
                        {assetTitle(row)}
                      </Link>
                    )}
                    <PriceHealthDot
                      kind={row.price_source_kind}
                      priceDate={row.price_date}
                    />
                  </span>
                </th>
                <td className="tabular px-3 py-[var(--row-pad)] text-right font-medium">
                  {assetHref === undefined ? (
                    <Money value={row.value} />
                  ) : (
                    <Link
                      to={assetHref(assetSlug(row))}
                      aria-label={`${TOTAL_LINK_LABEL}: ${row.ticker ?? row.name}`}
                      className="cursor-pointer hover:text-accent"
                    >
                      <Money value={row.value} />
                    </Link>
                  )}
                </td>
                <td className="px-3 py-[var(--row-pad)] text-right">
                  <span className="inline-flex items-center justify-end gap-2.5">
                    <WeightBar ratio={percentAsRatio(row.weight_pct)} className="w-20" />
                    <Percent
                      value={percentAsRatio(row.weight_pct)}
                      decimals={1}
                      className="w-14 text-right"
                    />
                  </span>
                </td>
              </tr>
            ))}
            <tr aria-hidden="true" className="h-full">
              <td colSpan={3} />
            </tr>
            <tr className="border-t border-line-2 bg-panel-2 font-semibold">
              <th
                scope="row"
                className="py-[var(--row-pad)] pl-3 text-left font-[inherit]"
              >
                {rows.length < total ? `Total das ${rows.length} maiores` : 'Total'}
              </th>
              <td className="tabular px-3 py-[var(--row-pad)] text-right">
                <Money value={shownValue} />
              </td>
              <td className="px-3 py-[var(--row-pad)] text-right">
                <span className="inline-flex items-center justify-end gap-2.5">
                  <WeightBar ratio={percentAsRatio(shownWeight)} className="w-20" />
                  <Percent
                    value={percentAsRatio(shownWeight)}
                    decimals={1}
                    className="w-14 text-right"
                  />
                </span>
              </td>
            </tr>
          </tbody>
        </FinTable>
      )}
    </Panel>
  );
};
