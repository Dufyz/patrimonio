import type { OverviewResource, PerformanceResource } from '@patrimonio/contracts';

type PerformanceClassRow = PerformanceResource['breakdown']['classes'][number];

import { useState } from 'react';

import { CompositionBar } from '../components/bars.js';
import { Icon } from '../components/icon.js';
import { Money, Percent, Points } from '../components/number.js';
import { percentAsRatio, trimDecimals } from '../lib/overview.js';
import { windowLabel } from '../lib/performance.js';
import { colorForToken } from '../lib/tokens.js';

/**
 * Por classe de ativo: a distribuição, o desvio do alvo e o retorno de cada
 * classe numa tabela só. A composição (peso e alvo) vem de Visão geral; o
 * retorno, de Desempenho. As duas leituras descrevem as mesmas classes, e duas
 * tabelas com as mesmas linhas obrigavam a ler uma contra a outra.
 */

const RETURN_KEYS = ['month', 'ytd', '12m', 'inception'] as const;

type ClassLine = {
  readonly id: string;
  readonly name: string;
  readonly colorToken: string;
  readonly value: string;
  readonly currentPct: string;
  readonly deviation: string | null;
  readonly hasTarget: boolean;
  readonly overTolerance: boolean;
  /** As categorias dentro da classe; vazio quando a classe é uma categoria solta. */
  readonly members: readonly ClassLine[];
};

const toLine = (
  line: OverviewResource['composition']['nodes'][number],
  members: readonly ClassLine[],
): ClassLine => ({
  id: line.id,
  name: line.name,
  colorToken: line.color_token,
  value: line.value,
  currentPct: line.current_pct,
  deviation: line.deviation_pp,
  hasTarget: line.target_pct !== null,
  overTolerance: line.over_tolerance,
  members,
});

/**
 * A classe é o grupo: uma linha por classe, com a categoria dentro como detalhe.
 * Categoria solta, sem grupo, é a própria classe. A "Outros" de um grupo (ativo
 * classificado direto nele) tem o id do grupo e já está no valor da classe.
 */
const classLines = (
  nodes: OverviewResource['composition']['nodes'],
): readonly ClassLine[] =>
  nodes.map((node) =>
    toLine(
      node,
      node.level === 'group'
        ? node.children
            .filter((child) => child.id !== node.id)
            .map((child) => toLine(child, []))
        : [],
    ),
  );

export const ClassesTable = ({
  overview,
  performance,
}: {
  readonly overview: OverviewResource;
  /** Ausente enquanto carrega ou quando falha: o retorno vira traço. */
  readonly performance: PerformanceResource | null;
}): React.ReactElement => {
  const lines = classLines(overview.composition.nodes);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // Todas as carteiras: o alvo é de cada carteira, e a soma delas não tem um.
  // A coluna some em vez de aparecer só com traço. O retorno da classe é Dietz
  // sobre a soma dos fluxos, e esse vale para qualquer escopo.
  const consolidated = overview.scope.portfolio_id === null;

  if (lines.length === 0) {
    return (
      <p className="p-4 text-[0.8125rem] text-ink-3">
        Sem posição em carteira na data da consolidação.
      </p>
    );
  }

  const returns = new Map<string, PerformanceClassRow>(
    (performance?.breakdown.classes ?? []).map((row) => [row.category_id, row]),
  );
  const labelContext = {
    referenceDate: overview.reference_date,
    inception: overview.scope.inception,
  };

  const withTarget = lines.filter((line) => line.hasTarget);
  const out = withTarget.filter((line) => line.overTolerance);
  const tolerance = trimDecimals(overview.scope.tolerance_pp);

  const note = consolidated
    ? 'O alvo é declarado por carteira: abra uma carteira para ver o desvio dela.'
    : withTarget.length === 0
      ? 'Nenhum alvo declarado: a estratégia desta carteira ainda não foi definida.'
      : out.length === 0
        ? `Todas as classes dentro da tolerância de ${tolerance} pp.`
        : `${out.length} ${out.length === 1 ? 'classe fora' : 'classes fora'} da tolerância de ${tolerance} pp.`;

  return (
    <>
      <div className="px-4 pt-4 pb-1">
        <CompositionBar
          slices={lines.map((line) => ({
            id: line.id,
            label: line.name,
            colorToken: line.colorToken,
            share: percentAsRatio(line.currentPct),
          }))}
          label="Composição por classe de ativo"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-160 border-collapse text-[0.8125rem]">
          <caption className="sr-only">
            Distribuição e retorno por classe de ativo
          </caption>
          <thead>
            <tr className="tabular text-label font-medium tracking-[0.06em] text-ink-3 uppercase">
              <th scope="col" className="px-4 py-[9px] text-left font-medium">
                Classe
              </th>
              <th scope="col" className="px-4 py-[9px] text-right font-medium">
                Valor
              </th>
              <th scope="col" className="px-4 py-[9px] text-right font-medium">
                Peso
              </th>
              {consolidated ? null : (
                <th scope="col" className="px-4 py-[9px] text-right font-medium">
                  vs alvo
                </th>
              )}
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
            {lines.flatMap((line) => {
              const row = returns.get(line.id);
              const expanded = open.has(line.id);
              const members = line.members.filter((member) => member.value !== '0.00');

              const classRow = (
                <tr key={line.id} className="h-(--row-height) border-t border-line">
                  <th scope="row" className="px-4 text-left font-normal">
                    <span className="flex items-center gap-2">
                      {members.length > 0 ? (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Recolher' : 'Expandir'} ${line.name}`}
                          className="flex w-3 cursor-pointer items-center text-ink-3"
                          onClick={() =>
                            setOpen((current) => {
                              const next = new Set(current);
                              if (!next.delete(line.id)) next.add(line.id);
                              return next;
                            })
                          }
                        >
                          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
                        </button>
                      ) : (
                        <span aria-hidden="true" className="w-3" />
                      )}
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-xs"
                        style={{ backgroundColor: colorForToken(line.colorToken) }}
                      />
                      {line.name}
                    </span>
                  </th>
                  <td className="px-4 text-right">
                    <Money value={line.value} />
                  </td>
                  <td className="px-4 text-right">
                    <Percent value={percentAsRatio(line.currentPct)} decimals={1} />
                  </td>
                  {consolidated ? null : (
                    <td className="px-4 text-right">
                      <Points
                        value={line.deviation}
                        decimals={1}
                        tone={line.overTolerance ? 'attention' : 'muted'}
                      />
                    </td>
                  )}
                  {RETURN_KEYS.map((key, index) => (
                    <td key={key} className="px-4 text-right">
                      <Percent
                        value={
                          row === undefined
                            ? null
                            : percentAsRatio(row.returns[index] ?? null)
                        }
                        decimals={2}
                        signed
                        tone="signed"
                      />
                    </td>
                  ))}
                </tr>
              );

              const memberRows = expanded
                ? members.map((member) => (
                    <tr
                      key={member.id}
                      className="h-(--row-height) border-t border-line text-ink-2"
                    >
                      <th scope="row" className="px-4 pl-12 text-left font-normal">
                        {member.name}
                      </th>
                      <td className="px-4 text-right">
                        <Money value={member.value} />
                      </td>
                      <td className="px-4 text-right">
                        <Percent value={percentAsRatio(member.currentPct)} decimals={1} />
                      </td>
                      <td colSpan={RETURN_KEYS.length + (consolidated ? 0 : 1)} />
                    </tr>
                  ))
                : [];

              return [classRow, ...memberRows];
            })}
          </tbody>
        </table>
      </div>

      <p className="border-t border-line px-4 py-3 text-xs text-ink-3">{note}</p>
    </>
  );
};
