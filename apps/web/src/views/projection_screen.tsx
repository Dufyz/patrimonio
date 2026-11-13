import type { ProjectionResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchProjection, putProjectionPlan } from '../api/projection.js';
import { ApiError } from '../api/client.js';
import { Money } from '../components/number.js';
import { KeepPrevious } from '../components/pending.js';
import { Button, Panel } from '../components/primitives.js';
import { SeriesChart } from '../components/series_chart.js';
import { ScreenHeader } from '../finance/components/screen_header.js';
import { EmptyPanel, PanelError } from '../finance/components/states.js';
import { TableScreenSkeleton } from '../finance/components/screen_skeletons.js';
import {
  HORIZONS,
  horizonFromParam,
  monthLabel,
  monthlyContributions,
  parseAmountText,
  parseReturnText,
  returnText,
  rulesAmountAt,
} from '../lib/projection_view.js';
import { useResource } from '../lib/use_resource.js';
import { Input, Select } from './entry/fields.js';

/**
 * PRJ-02..08 · Projeção: quanto as carteiras valem daqui para a frente se o
 * plano de aportes for seguido. Servida pelo motor da `api`: a tela lê série e
 * KPIs e não faz conta. A rentabilidade esperada e as regras de aporte se
 * editam aqui mesmo e são gravadas na carteira.
 */
const COLORS = [
  'var(--color-accent)',
  'var(--color-cat-green)',
  'var(--color-cat-orange)',
  'var(--color-cat-rose)',
  'var(--color-cat-teal)',
  'var(--color-cat-violet)',
] as const;

const FIRST_ROWS = 24;

type Portfolio = ProjectionResource['portfolios'][number];
type DraftRule = { readonly key: string; amount: string; from: string; until: string };
type Draft = { returnText: string; rules: DraftRule[] };

let counter = 0;
const nextKey = (): string => `r${(counter += 1)}`;

const draftOf = (portfolio: Portfolio): Draft => ({
  returnText: returnText(portfolio.expected_return_pct),
  rules: portfolio.rules.map((rule) => ({
    key: nextKey(),
    amount: rule.amount.replace('.', ','),
    from: rule.from,
    until: rule.until ?? '',
  })),
});

const ruleError = (rule: DraftRule): string | null => {
  if (parseAmountText(rule.amount) === undefined) return 'Valor inválido';
  if (!/^\d{4}-\d{2}$/.test(rule.from)) return 'Início inválido';
  if (rule.until !== '' && rule.until < rule.from) return 'O fim vem depois do início';
  return null;
};

const draftError = (draft: Draft): string | null =>
  parseReturnText(draft.returnText) === undefined
    ? 'Rentabilidade de 0 a 100%'
    : (draft.rules.map(ruleError).find((error) => error !== null) ?? null);

const sameDraft = (a: Draft, b: Draft): boolean =>
  a.returnText === b.returnText &&
  a.rules.length === b.rules.length &&
  a.rules.every((rule, i) => {
    const other = b.rules[i];
    return (
      other !== undefined &&
      rule.amount === other.amount &&
      rule.from === other.from &&
      rule.until === other.until
    );
  });

export const ProjectionScreen = ({
  portfolioId,
  scopeLabel,
}: {
  readonly portfolioId: string | null;
  readonly scopeLabel: string;
}): React.ReactElement => {
  const [params, setParams] = useSearchParams();
  const horizon = horizonFromParam(params.get('horizonte'));
  const resource = useResource(
    (signal) => fetchProjection(portfolioId, horizon, signal),
    [portfolioId, horizon],
  );

  if (resource.state.kind === 'loading') {
    return <TableScreenSkeleton label="Carregando a projeção" columns={5} />;
  }
  if (resource.state.kind === 'error') {
    return (
      <PanelError
        title="Não foi possível carregar a projeção"
        onRetry={resource.reload}
      />
    );
  }

  return (
    <Loaded
      key={`${portfolioId ?? 'todas'}`}
      data={resource.state.value}
      pending={resource.pending}
      scopeLabel={scopeLabel}
      horizon={horizon}
      onHorizon={(value) =>
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            if (value === 24) next.delete('horizonte');
            else next.set('horizonte', String(value));
            return next;
          },
          { replace: true },
        )
      }
      onSaved={resource.reload}
      single={portfolioId !== null}
    />
  );
};

const Loaded = ({
  data,
  pending,
  scopeLabel,
  horizon,
  onHorizon,
  onSaved,
  single,
}: {
  readonly data: ProjectionResource;
  readonly pending: boolean;
  readonly scopeLabel: string;
  readonly horizon: number;
  readonly onHorizon: (value: number) => void;
  readonly onSaved: () => void;
  readonly single: boolean;
}): React.ReactElement => {
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [allMonths, setAllMonths] = useState(false);

  const original = useMemo(
    () =>
      Object.fromEntries(
        data.portfolios.map((item) => [item.portfolio_id, draftOf(item)]),
      ),
    [data],
  );
  const current = (id: string): Draft =>
    drafts[id] ?? original[id] ?? { returnText: '', rules: [] };
  const dirty = data.portfolios.filter((item) => {
    const draft = drafts[item.portfolio_id];
    const base = original[item.portfolio_id];
    return draft !== undefined && base !== undefined && !sameDraft(draft, base);
  });
  const firstError =
    dirty.map((item) => draftError(current(item.portfolio_id))).find(Boolean) ?? null;

  const edit = (id: string, change: (draft: Draft) => Draft): void =>
    setDrafts((all) => {
      const base = all[id] ?? original[id] ?? { returnText: '', rules: [] };
      return {
        ...all,
        [id]: change({ returnText: base.returnText, rules: [...base.rules] }),
      };
    });

  const save = async (): Promise<void> => {
    if (dirty.length === 0 || firstError !== null || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      for (const item of dirty) {
        const draft = current(item.portfolio_id);
        await putProjectionPlan(
          item.portfolio_id,
          {
            expected_return_pct: parseReturnText(draft.returnText) ?? null,
            rules: draft.rules.map((rule) => ({
              amount: parseAmountText(rule.amount) ?? '0.01',
              from: rule.from,
              until: rule.until === '' ? null : rule.until,
            })),
          },
          item.version,
        );
      }
      setDrafts({});
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // O plano mudou em outro lugar: a tela mostra o estado atual do servidor.
        setDrafts({});
        onSaved();
        setFailure(
          'O plano mudou desde que você o abriu. Mostrando o estado atual: confira e salve de novo.',
        );
      } else {
        setFailure(error instanceof Error ? error.message : 'Não foi possível salvar');
      }
    } finally {
      setSaving(false);
    }
  };

  // ⌘↵ salva de qualquer campo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void save();
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  });

  const total = data.total;
  const projected = data.portfolios.filter((item) => item.projection !== null);
  const months = total?.series.map((point) => point.month) ?? [];
  const contributions = total === null ? [] : monthlyContributions(total);
  const shownMonths = allMonths ? months.length : Math.min(months.length, FIRST_ROWS + 1);
  const unconsolidated = data.portfolios.filter((item) => item.projection === null);

  const series = [
    ...(single || total === null
      ? []
      : [
          {
            id: 'total',
            label: 'Total',
            color: 'var(--color-ink)',
            points: total.series.map((point) => ({
              date: `${point.month}-01` as DateOnly,
              value: point.value,
            })),
          },
        ]),
    ...projected.map((item, index) => ({
      id: item.portfolio_id,
      label: item.name,
      color: COLORS[index % COLORS.length] ?? 'var(--color-accent)',
      points: (item.projection?.series ?? []).map((point) => ({
        date: `${point.month}-01` as DateOnly,
        value: point.value,
      })),
    })),
  ];

  const horizonControl = (
    <label className="flex items-center gap-2 text-sm text-ink-2">
      Horizonte:
      <Select
        invalid={false}
        aria-label="Horizonte"
        value={String(horizon)}
        options={HORIZONS.map((item) => ({ id: String(item.value), name: item.label }))}
        onChange={(event) => onHorizon(Number(event.target.value))}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title={single ? `Projeção · ${scopeLabel}` : 'Projeção · Todas as carteiras'}
        subtitle={`Quanto ${single ? 'a carteira vale' : 'as carteiras valem'} se o plano de aportes for seguido · a partir de ${monthLabel(months[0] ?? data.as_of.slice(0, 7))}`}
        period={horizonControl}
      />

      <KeepPrevious pending={pending}>
        {total === null ? (
          <EmptyPanel message="Projeção indisponível: as carteiras ainda não foram consolidadas. Lance um aporte para ter de onde partir." />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line lg:grid-cols-4">
              {[
                ['Hoje', total.kpis.today],
                ['No horizonte', total.kpis.at_horizon],
                ['Aportes no período', total.kpis.contributions],
                ['Rendimento estimado', total.kpis.estimated_yield],
              ].map(([label, value]) => (
                <div key={label} className="bg-panel px-4 py-3">
                  <dt className="text-xs text-ink-3">{label}</dt>
                  <dd className="tabular text-lg font-semibold">
                    <Money value={value ?? '0'} decimals={0} />
                  </dd>
                </div>
              ))}
            </dl>

            <Panel title={single ? 'Evolução da carteira' : 'Evolução das carteiras'}>
              <div className="px-4 py-3">
                <SeriesChart
                  dates={months.map((month) => `${month}-01` as DateOnly)}
                  series={series}
                  valueFormat="money"
                  ariaLabel="Valor projetado por mês"
                  height={260}
                  fromZero
                  xTickLabel={(date) => monthLabel(date.slice(0, 7))}
                  tooltipDateLabel={(date) => monthLabel(date.slice(0, 7))}
                />
              </div>
            </Panel>
          </>
        )}

        <Panel title="Rentabilidade esperada" hint="ao ano, por carteira">
          <table className="w-full text-[0.8125rem]">
            <caption className="sr-only">Rentabilidade esperada por carteira</caption>
            <thead>
              <tr className="border-b border-line bg-panel-2 text-left text-xs text-ink-3">
                <th scope="col" className="px-4 py-2 font-medium">
                  Carteira
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Valor hoje
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Rentabilidade esperada
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-right font-medium max-[900px]:hidden"
                >
                  Aporte mensal
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Valor no horizonte
                </th>
              </tr>
            </thead>
            <tbody>
              {data.portfolios.map((item) => {
                const draft = current(item.portfolio_id);
                const invalid = parseReturnText(draft.returnText) === undefined;
                return (
                  <tr key={item.portfolio_id} className="h-12 border-b border-line">
                    <th scope="row" className="px-4 text-left font-semibold">
                      {item.name}
                    </th>
                    <td className="px-4 text-right">
                      {item.current_value === null ? (
                        '—'
                      ) : (
                        <Money value={item.current_value} />
                      )}
                    </td>
                    <td className="px-4 text-right">
                      <span className="inline-flex w-28 items-center gap-1">
                        <Input
                          invalid={invalid}
                          numeric
                          inputMode="decimal"
                          aria-label={`Rentabilidade esperada de ${item.name}`}
                          placeholder="0,00"
                          value={draft.returnText}
                          onChange={(event) =>
                            edit(item.portfolio_id, (d) => ({
                              ...d,
                              returnText: event.target.value,
                            }))
                          }
                        />
                        <span aria-hidden="true" className="text-ink-3">
                          %
                        </span>
                      </span>
                      {item.return_assumed_zero && draft.returnText === '' ? (
                        <p className="mt-0.5 text-[0.6875rem] text-attention">
                          sem rentabilidade: usando 0,00%
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 text-right max-[900px]:hidden">
                      <Money
                        value={rulesAmountAt(
                          item.rules,
                          months[1] ?? data.as_of.slice(0, 7),
                        )}
                      />
                    </td>
                    <td className="px-4 text-right">
                      {item.projection === null ? (
                        '—'
                      ) : (
                        <Money value={item.projection.kpis.at_horizon} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {unconsolidated.length === 0 ? null : (
            <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
              Carteira ainda não consolidada:{' '}
              {unconsolidated.map((item) => item.name).join(', ')}.
            </p>
          )}
        </Panel>

        <Panel title="Plano de aportes" hint="valor fixo por mês, por carteira">
          <div className="flex flex-col divide-y divide-line">
            {data.portfolios.map((item) => {
              const draft = current(item.portfolio_id);
              return (
                <section
                  key={item.portfolio_id}
                  aria-label={`Regras de ${item.name}`}
                  className="px-4 py-3"
                >
                  <header className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">{item.name}</h3>
                    <Button
                      onClick={() =>
                        edit(item.portfolio_id, (d) => ({
                          ...d,
                          rules: [
                            ...d.rules,
                            {
                              key: nextKey(),
                              amount: '',
                              from: data.as_of.slice(0, 7),
                              until: '',
                            },
                          ],
                        }))
                      }
                    >
                      Adicionar regra
                    </Button>
                  </header>
                  {draft.rules.length === 0 ? (
                    <p className="text-sm text-ink-3">
                      Sem aportes planejados: a projeção segue só com rendimento.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {draft.rules.map((rule, index) => {
                        const error = ruleError(rule);
                        const change = (patch: Partial<DraftRule>): void =>
                          edit(item.portfolio_id, (d) => ({
                            ...d,
                            rules: d.rules.map((r, i) =>
                              i === index ? { ...r, ...patch } : r,
                            ),
                          }));
                        return (
                          <li
                            key={rule.key}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <Input
                              invalid={error === 'Valor inválido'}
                              numeric
                              inputMode="decimal"
                              aria-label={`Valor da regra ${index + 1} de ${item.name}`}
                              placeholder="R$ por mês"
                              className="w-32"
                              value={rule.amount}
                              onChange={(event) => change({ amount: event.target.value })}
                            />
                            <label className="flex items-center gap-1 text-xs text-ink-3">
                              a partir de
                              <Input
                                invalid={error === 'Início inválido'}
                                type="month"
                                aria-label={`Início da regra ${index + 1} de ${item.name}`}
                                value={rule.from}
                                onChange={(event) => change({ from: event.target.value })}
                              />
                            </label>
                            <label className="flex items-center gap-1 text-xs text-ink-3">
                              até
                              <Input
                                invalid={error === 'O fim vem depois do início'}
                                type="month"
                                aria-label={`Fim da regra ${index + 1} de ${item.name}`}
                                value={rule.until}
                                onChange={(event) =>
                                  change({ until: event.target.value })
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="cursor-pointer text-xs text-negative underline"
                              onClick={() =>
                                edit(item.portfolio_id, (d) => ({
                                  ...d,
                                  rules: d.rules.filter((_, i) => i !== index),
                                }))
                              }
                            >
                              Remover
                            </button>
                            {error === null ? null : (
                              <span role="alert" className="text-xs text-negative">
                                {error}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </Panel>

        {total === null ? null : (
          <Panel title="Mês a mês">
            <div className="overflow-x-auto">
              <table className="w-full text-[0.8125rem]">
                <caption className="sr-only">Evolução mês a mês</caption>
                <thead>
                  <tr className="border-b border-line bg-panel-2 text-xs text-ink-3">
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Mês
                    </th>
                    {projected.map((item, index) => (
                      <th
                        key={item.portfolio_id}
                        scope="col"
                        className={`px-4 py-2 text-right font-medium ${
                          index >= 2
                            ? 'max-[1100px]:hidden'
                            : index >= 1
                              ? 'max-[800px]:hidden'
                              : ''
                        }`}
                      >
                        {item.name}
                      </th>
                    ))}
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Total
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-right font-medium max-[700px]:hidden"
                    >
                      Aporte do mês
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Aporte acumulado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {total.series.slice(0, shownMonths).map((point, row) => (
                    <tr key={point.month} className="h-9 border-b border-line">
                      <th scope="row" className="px-4 text-left font-normal">
                        {monthLabel(point.month)}
                        {row === 0 ? <span className="ml-1 text-ink-3">hoje</span> : null}
                      </th>
                      {projected.map((item, index) => (
                        <td
                          key={item.portfolio_id}
                          className={`px-4 text-right ${
                            index >= 2
                              ? 'max-[1100px]:hidden'
                              : index >= 1
                                ? 'max-[800px]:hidden'
                                : ''
                          }`}
                        >
                          <Money
                            value={item.projection?.series[row]?.value ?? '0'}
                            decimals={0}
                          />
                        </td>
                      ))}
                      <td className="px-4 text-right font-semibold">
                        <Money value={point.value} decimals={0} />
                      </td>
                      <td className="px-4 text-right max-[700px]:hidden">
                        <Money value={contributions[row] ?? '0'} decimals={0} />
                      </td>
                      <td className="px-4 text-right">
                        <Money value={point.contributions_cumulative} decimals={0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {months.length > FIRST_ROWS + 1 && !allMonths ? (
              <div className="border-t border-line px-4 py-2">
                <Button onClick={() => setAllMonths(true)}>Ver todos os meses</Button>
              </div>
            ) : null}
          </Panel>
        )}
      </KeepPrevious>

      {dirty.length === 0 && failure === null ? null : (
        <div
          role="region"
          aria-label="Salvar plano"
          className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-panel px-4 py-3 shadow-panel"
        >
          <span
            className={`text-sm ${failure === null && firstError === null ? 'text-ink-2' : 'text-negative'}`}
          >
            {failure ?? firstError ?? 'Alterações no plano ainda não salvas.'}
          </span>
          <span className="flex items-center gap-2">
            <Button
              onClick={() => {
                setDrafts({});
                setFailure(null);
              }}
            >
              Descartar
            </Button>
            <Button
              variant="primary"
              disabled={firstError !== null || saving}
              onClick={() => void save()}
            >
              Salvar
            </Button>
          </span>
        </div>
      )}
    </div>
  );
};
