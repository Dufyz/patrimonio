import type {
  AllocationContributionResource,
  AllocationResource,
  PutStrategyBody,
} from '@patrimonio/contracts';
import { useEffect, useMemo, useState } from 'react';

import { fetchAllocation, putStrategy } from '../api/allocation.js';
import { Money, MoneyChange, Percent, Points } from '../components/number.js';
import { Modal } from '../components/overlay.js';
import { KeepPrevious } from '../components/pending.js';
import { usePreferences } from '../components/preferences.js';
import { Button, IconButton, Kbd, Label, Panel } from '../components/primitives.js';
import { formatDate, percentAsRatio } from '../lib/overview.js';
import {
  EMPTY_DRAFT,
  WHOLE,
  barPosition,
  barScale,
  buildBody,
  editableRows,
  fieldError,
  fromPercent,
  groupTotal,
  isZeroDecimal,
  inputText,
  parseAmount,
  saveState,
  targetLabel,
  toleranceBand,
  valueText,
  withEdit,
} from '../lib/strategy.js';
import type { Draft, EditableRow } from '../lib/strategy.js';
import { colorForToken } from '../lib/tokens.js';
import type { Resource } from '../lib/use_resource.js';
import { useResource } from '../lib/use_resource.js';

/**
 * T-06 · Estratégia — a prancha `09 · Estratégia`.
 *
 * A tela responde uma pergunta: **o dinheiro está dividido como eu disse que
 * queria?** O alvo se edita na própria tabela, ao lado do que a carteira tem
 * hoje, porque é ali que se vê o que cada ponto de alvo custa em reais.
 *
 * A estratégia é de uma carteira.
 *
 * Nenhum valor em reais é calculado aqui. Desvio, valor no alvo e valor a mover
 * chegam prontos; a única conta do navegador é a soma dos alvos digitados, em
 * inteiros (`lib/strategy.ts`), porque é ela que trava o botão de salvar.
 */

type Node = AllocationResource['composition']['nodes'][number];
type Line = Node | Node['children'][number];

export type StrategyViewProps = {
  readonly resource: Resource<AllocationResource>;
  readonly onSave: (body: PutStrategyBody) => Promise<void>;
  /** O plano de um aporte: a mesma leitura, com o valor. Nulo se a `api` não devolve plano. */
  readonly onPlan: (amount: string) => Promise<AllocationContributionResource | null>;
};

export type StrategyScreenProps = {
  readonly portfolioId: string;
};

export const StrategyScreen = ({
  portfolioId,
}: StrategyScreenProps): React.ReactElement => (
  // Trocar de carteira recomeça a tela: rascunho de uma não é rascunho da outra.
  <LoadedStrategy key={portfolioId} portfolioId={portfolioId} />
);

const LoadedStrategy = ({
  portfolioId,
}: {
  readonly portfolioId: string;
}): React.ReactElement => {
  const resource = useResource(
    (signal) => fetchAllocation({ portfolioId }, signal),
    [portfolioId],
  );

  return (
    <StrategyView
      resource={resource}
      onSave={async (body) => {
        await putStrategy(portfolioId, body);
        resource.reload();
      }}
      onPlan={async (amount) =>
        (await fetchAllocation({ portfolioId, contribution: amount })).contribution
      }
    />
  );
};

/* -------------------------------------------------------------------------- */
/* Regras                                                                      */

const Rules = ({
  rules,
}: {
  readonly rules: AllocationResource['rules'];
}): React.ReactElement => {
  const tolerance = inputText(fromPercent(rules.tolerance_pp));

  return (
    <Panel title="Regras da estratégia">
      <div className="grid grid-cols-1 md:grid-cols-2">
        <div className="flex flex-col gap-1 border-line p-4">
          <Label>Tolerância</Label>
          <span className="tabular text-base font-semibold">{`± ${tolerance} pp`}</span>
          <p className="text-[0.8125rem] text-ink-2">
            Acima disso a categoria entra em Requer atenção.
          </p>
        </div>
        <div className="flex flex-col gap-1 border-line p-4 md:border-l">
          <Label>Benchmark</Label>
          <span className="tabular text-base font-semibold">
            {rules.benchmark?.name ?? 'Sem benchmark'}
          </span>
          <p className="text-[0.8125rem] text-ink-2">
            Usado em Desempenho quando esta carteira está selecionada.
          </p>
        </div>
      </div>
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* A tabela                                                                    */

const TargetField = ({
  row,
  draft,
  onChange,
}: {
  readonly row: EditableRow;
  readonly draft: Draft;
  readonly onChange: (id: string, text: string) => void;
}): React.ReactElement => {
  const text = valueText(row, draft);
  const error = fieldError(text);

  return (
    <span
      className={`inline-flex h-8 w-24 items-center rounded-control border bg-panel pr-2 ${
        error === null ? 'border-line-strong' : 'border-negative'
      } ${row.id in draft ? 'ring-1 ring-accent' : ''}`}
      title={error ?? undefined}
    >
      <input
        inputMode="decimal"
        aria-label={`Alvo de ${row.name}`}
        aria-invalid={error !== null}
        value={text}
        onChange={(event) => onChange(row.id, event.target.value)}
        onFocus={(event) => event.target.select()}
        className="tabular min-w-0 flex-1 bg-transparent px-2 text-right outline-none"
      />
      <span aria-hidden="true" className="text-[0.75rem] text-ink-3">
        %
      </span>
    </span>
  );
};

const DeviationBar = ({
  line,
  scale,
  tolerance,
}: {
  readonly line: Line;
  readonly scale: number;
  readonly tolerance: string;
}): React.ReactElement => {
  const band = toleranceBand(line.target_pct, tolerance, scale);
  const label =
    line.target_pct === null
      ? `${line.name}: atual ${line.current_pct}%, sem alvo`
      : `${line.name}: atual ${line.current_pct}%, alvo ${line.target_pct}%`;

  return (
    <span
      role="img"
      aria-label={label}
      className="relative block h-2 w-56 rounded-full bg-panel-2"
    >
      {band === null ? null : (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 bg-ink/5"
          style={{ left: `${band.left}%`, width: `${band.width}%` }}
        />
      )}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${barPosition(line.current_pct, scale)}%`,
          minWidth: 3,
          backgroundColor: colorForToken(line.color_token),
        }}
      />
      {line.target_pct === null ? null : (
        <span
          aria-hidden="true"
          className="absolute -inset-y-0.5 w-0.5 bg-ink"
          style={{ left: `${barPosition(line.target_pct, scale)}%` }}
        />
      )}
    </span>
  );
};

const Cells = ({
  line,
  defined,
  scale,
  tolerance,
  bar = true,
}: {
  /** O grupo é a soma das categorias: a barra é de quem tem alvo próprio. */
  readonly bar?: boolean;
  readonly line: Line;
  readonly defined: boolean;
  readonly scale: number;
  readonly tolerance: string;
}): React.ReactElement => (
  <>
    <td className="px-4 text-right">
      <Percent value={percentAsRatio(line.current_pct)} decimals={1} />
    </td>
    <td
      className={`px-4 text-right ${line.over_tolerance ? 'font-semibold text-attention' : ''}`}
      title={line.over_tolerance ? 'Acima da tolerância' : undefined}
    >
      {isZeroDecimal(line.deviation_pp) ? (
        <span className="tabular">0,0 pp</span>
      ) : (
        <Points value={defined ? line.deviation_pp : null} tone="neutral" />
      )}
    </td>
    <td className="px-4">
      {bar ? <DeviationBar line={line} scale={scale} tolerance={tolerance} /> : null}
    </td>
    <td className="px-4 text-right">
      <Money value={line.value} bare />
    </td>
    <td className="px-4 text-right">
      <Money value={defined ? line.target_value : null} bare />
    </td>
    <td className="px-4 text-right">
      {isZeroDecimal(line.amount_to_move) ? (
        <Money value={line.amount_to_move} bare />
      ) : (
        <MoneyChange value={defined ? line.amount_to_move : null} bare />
      )}
    </td>
  </>
);

const Distribution = ({
  data,
  rows,
  draft,
  onChange,
  onRestore,
}: {
  readonly data: AllocationResource;
  readonly rows: readonly EditableRow[];
  readonly draft: Draft;
  readonly onChange: (id: string, text: string) => void;
  readonly onRestore: () => void;
}): React.ReactElement => {
  const { composition, strategy_defined: defined, rules } = data;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const scale = useMemo(() => barScale(composition.nodes), [composition.nodes]);
  const state = saveState(rows, draft);
  const editing = Object.keys(draft).length > 0;
  const total = state.total;
  const tolerance = rules.tolerance_pp;

  const toggle = (id: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const rowFor = (id: string): EditableRow | undefined =>
    rows.find((row) => row.id === id);

  const categoryRow = (line: Line, indent: boolean): React.ReactElement => {
    const editable = rowFor(line.id);

    return (
      <tr key={line.id} className="h-(--row-height) border-b border-line">
        <th scope="row" className={`px-4 text-left font-normal ${indent ? 'pl-10' : ''}`}>
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-xs"
              style={{ backgroundColor: colorForToken(line.color_token) }}
            />
            <span className={indent ? '' : 'font-semibold'}>{line.name}</span>
          </span>
        </th>
        <td className="px-4 text-right">
          {editable === undefined ? (
            <span className="text-ink-3" title="Sem categoria não recebe alvo">
              —
            </span>
          ) : (
            <TargetField row={editable} draft={draft} onChange={onChange} />
          )}
        </td>
        <Cells line={line} defined={defined} scale={scale} tolerance={tolerance} />
      </tr>
    );
  };

  return (
    <Panel
      title="Distribuição por categoria"
      hint={`Alvo em dois níveis: grupo e categoria. O grupo é a soma das categorias. Tolerância ± ${inputText(fromPercent(tolerance))} pp.`}
      action={
        <span className="flex items-center gap-2">
          <Button disabled title="Criar e reorganizar categorias chega com Configurações">
            Categorias
          </Button>
          <Button disabled={!editing} onClick={onRestore}>
            Restaurar
          </Button>
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-250 border-collapse text-[0.8125rem]">
          <caption className="sr-only">Distribuição por categoria contra o alvo</caption>
          <thead>
            <tr className="border-b border-line bg-panel-2 text-label tracking-wide text-ink-3 uppercase">
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Categoria
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Alvo
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Atual
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Desvio
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Atual × alvo
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Valor atual
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Valor no alvo
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Para o alvo
              </th>
            </tr>
          </thead>
          <tbody>
            {composition.nodes.flatMap((node) => {
              if (node.level !== 'group') return [categoryRow(node, false)];

              const sum = groupTotal(rows, draft, node.id);
              const open = !collapsed.has(node.id);

              return [
                <tr
                  key={node.id}
                  className="h-(--row-height) border-b border-line bg-panel-2"
                >
                  <th scope="row" className="px-4 text-left font-semibold">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={`${open ? 'Recolher' : 'Expandir'} ${node.name}`}
                      className="flex cursor-pointer items-center gap-2"
                      onClick={() => toggle(node.id)}
                    >
                      <span aria-hidden="true" className="w-3 text-ink-3">
                        {open ? '⌄' : '›'}
                      </span>
                      {node.name}
                    </button>
                  </th>
                  <td className="tabular px-4 text-right font-semibold">
                    {defined || editing ? (sum === null ? '—' : targetLabel(sum)) : '—'}
                  </td>
                  <Cells
                    line={node}
                    defined={defined}
                    scale={scale}
                    tolerance={tolerance}
                    bar={false}
                  />
                </tr>,
                ...(open ? node.children.map((child) => categoryRow(child, true)) : []),
              ];
            })}
          </tbody>
          <tfoot>
            <tr className="h-(--row-height) font-semibold">
              <th scope="row" className="px-4 text-left">
                Total
              </th>
              <td
                className={`tabular px-4 text-right ${
                  total === WHOLE ? 'text-positive' : total === 0 ? '' : 'text-negative'
                }`}
              >
                {total === null ? '—' : total === WHOLE ? '✓ 100%' : targetLabel(total)}
              </td>
              <td className="tabular px-4 text-right">100%</td>
              <td />
              <td />
              <td className="px-4 text-right">
                <Money value={composition.total} bare />
              </td>
              <td className="px-4 text-right">
                <Money value={defined ? composition.total : null} bare />
              </td>
              <td className="px-4 text-right">
                <Money value={defined ? '0' : null} bare />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-[0.75rem] text-ink-3">
        <span>
          Os alvos são editados direto na tabela. Ao alterar, aparece uma barra para
          salvar ou descartar; não é possível salvar se a soma não der 100%.
          {editing
            ? ' Desvio e valores continuam os da estratégia salva até você salvar.'
            : ''}
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Tab</Kbd> próximo campo · <Kbd>⌘S</Kbd> salvar
        </span>
      </p>
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* Barra de salvar                                                             */

const SaveBar = ({
  rows,
  draft,
  saving,
  failure,
  onSave,
  onDiscard,
}: {
  readonly rows: readonly EditableRow[];
  readonly draft: Draft;
  readonly saving: boolean;
  readonly failure: string | null;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
}): React.ReactElement | null => {
  const state = saveState(rows, draft);
  if (state.changed === 0 && state.invalid.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Alterações não salvas"
      className={`sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-panel border px-4 py-3 shadow-lg ${
        state.blocked ? 'border-negative bg-negative-soft' : 'border-line bg-panel'
      }`}
    >
      <span
        role={state.blocked || failure !== null ? 'alert' : 'status'}
        className={`text-[0.8125rem] ${state.blocked || failure !== null ? 'text-negative' : ''}`}
      >
        {failure ?? state.message}
      </span>
      <span className="flex gap-2">
        <Button disabled={saving} onClick={onDiscard}>
          Descartar
        </Button>
        <Button
          variant="primary"
          shortcut="⌘S"
          disabled={!state.canSave || saving}
          onClick={onSave}
        >
          Salvar estratégia
        </Button>
      </span>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Planejar aporte                                                             */

const PlanDialog = ({
  onClose,
  onPlan,
  blocked,
}: {
  readonly onClose: () => void;
  readonly onPlan: StrategyViewProps['onPlan'];
  readonly blocked: boolean;
}): React.ReactElement => {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<AllocationContributionResource | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = parseAmount(text);

  const run = async (): Promise<void> => {
    if (amount === null) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await onPlan(amount);
      setPlan(result);
      if (result === null) setFailure('A api não devolveu um plano para este valor');
    } catch (error) {
      setPlan(null);
      setFailure(error instanceof Error ? error.message : 'Não foi possível planejar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Planejar aporte"
      subtitle="Como distribuir um aporte para chegar mais perto do alvo salvo"
      onClose={onClose}
      footer={
        <>
          <span role="alert" className="text-[0.8125rem] text-negative">
            {failure}
          </span>
          <span className="flex gap-2">
            <Button onClick={onClose}>Fechar</Button>
            <Button
              variant="primary"
              disabled={amount === null || busy || blocked}
              onClick={() => void run()}
            >
              Calcular
            </Button>
          </span>
        </>
      }
    >
      <label className="flex flex-col gap-2 text-[0.8125rem]">
        <span className="text-ink-2">Valor do aporte, em reais</span>
        <input
          data-autofocus
          inputMode="decimal"
          aria-label="Valor do aporte"
          placeholder="4.000,00"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPlan(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void run();
          }}
          className="tabular h-control w-48 rounded-control border border-line bg-panel px-3 text-right"
        />
        {text.trim() !== '' && amount === null ? (
          <span className="text-negative">Use um valor acima de zero, como 4.000,00</span>
        ) : null}
        {blocked ? (
          <span className="text-attention">
            Salve ou descarte as alterações do alvo: o plano usa a estratégia salva.
          </span>
        ) : null}
      </label>

      {plan === null ? null : (
        <div className="mt-4 flex flex-col gap-3">
          <table className="w-full border-collapse text-[0.8125rem]">
            <caption className="sr-only">Plano de aporte por categoria</caption>
            <thead>
              <tr className="border-y border-line bg-panel-2 text-label tracking-wide text-ink-3 uppercase">
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Categoria
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Aportar
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Desvio depois
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.shares.map((share) => (
                <tr
                  key={share.category_id}
                  className="h-(--row-height) border-b border-line"
                >
                  <th scope="row" className="px-3 text-left font-normal">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-xs"
                        style={{ backgroundColor: colorForToken(share.color_token) }}
                      />
                      {share.name}
                    </span>
                  </th>
                  <td className="px-3 text-right">
                    <Money value={share.amount} bare />
                  </td>
                  <td className="px-3 text-right">
                    <Points value={share.deviation_after_pp} tone="neutral" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[0.8125rem]">
            <dt className="text-ink-2">Distribuído</dt>
            <dd className="text-right">
              <Money value={plan.allocated} />
            </dd>
            {fromPercent(plan.unallocated) === 0 ? null : (
              <>
                <dt className="text-ink-2">Fica em conta</dt>
                <dd className="text-right">
                  <Money value={plan.unallocated} />
                </dd>
              </>
            )}
            <dt className="text-ink-2">Maior desvio</dt>
            <dd className="text-right">
              <Points value={plan.max_deviation_before_pp} tone="neutral" /> →{' '}
              <Points value={plan.max_deviation_after_pp} tone="neutral" />
            </dd>
          </dl>
        </div>
      )}
    </Modal>
  );
};

/* -------------------------------------------------------------------------- */
/* A moldura                                                                   */

const Failed = ({
  error,
  onRetry,
}: {
  readonly error: Error;
  readonly onRetry: () => void;
}): React.ReactElement => (
  <section
    role="alert"
    className="rounded-panel border border-line bg-panel p-8 text-center"
  >
    <h2 className="text-panel-title font-semibold text-negative">
      A tela não pôde ser carregada
    </h2>
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      {error.message}
    </p>
    <button
      type="button"
      className="mt-4 h-control cursor-pointer rounded-control border border-line px-3 text-[0.8125rem] hover:bg-panel-2"
      onClick={onRetry}
    >
      Tentar de novo
    </button>
  </section>
);

export const StrategyView = ({
  resource,
  onSave,
  onPlan,
}: StrategyViewProps): React.ReactElement => {
  const { state, pending, reload } = resource;
  const { hidden, toggleHidden } = usePreferences();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);

  const data = state.kind === 'ready' ? state.value : null;
  const rows = useMemo(
    () => (data === null ? [] : editableRows(data.composition.nodes)),
    [data],
  );
  const status = saveState(rows, draft);

  const save = async (): Promise<void> => {
    if (!status.canSave || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      await onSave(buildBody(rows, draft));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível salvar');
    } finally {
      setSaving(false);
    }
  };

  // ⌘S salva de qualquer campo, e o navegador não abre "Salvar página".
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  });

  if (state.kind === 'loading') {
    return (
      <p aria-busy="true" className="p-8 text-center text-[0.8125rem] text-ink-3">
        Carregando a estratégia…
      </p>
    );
  }
  if (state.kind === 'error') return <Failed error={state.error} onRetry={reload} />;

  const value = state.value;
  const subtitle = [
    value.portfolio.name,
    'como o dinheiro desta carteira deve ser dividido',
    value.reference_date === null
      ? null
      : `fechamento de ${formatDate(value.reference_date as never)}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-screen-title font-semibold tracking-tight">Estratégia</h1>
          <p className="truncate text-[0.8125rem] text-ink-2">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
            aria-pressed={hidden}
            onClick={toggleHidden}
          >
            <span aria-hidden="true">{hidden ? '◌' : '◉'}</span>
          </IconButton>
          <Button
            variant="primary"
            disabled={!value.strategy_defined}
            title={
              value.strategy_defined
                ? undefined
                : 'Defina e salve os alvos para planejar um aporte'
            }
            onClick={() => setPlanning(true)}
          >
            Planejar aporte
          </Button>
        </div>
      </header>

      <Rules rules={value.rules} />

      {value.reference_date === null ? (
        <section className="rounded-panel border border-line bg-panel p-8 text-center">
          <h2 className="text-panel-title font-semibold">Nenhum fechamento ainda</h2>
          <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
            {value.portfolio.name} não tem posição para comparar com o alvo. A estratégia
            aparece no primeiro fechamento.
          </p>
        </section>
      ) : (
        <KeepPrevious pending={pending && !saving} className="flex flex-col gap-4">
          <Distribution
            data={value}
            rows={rows}
            draft={draft}
            onChange={(id, text) => {
              setFailure(null);
              setDraft((current) => withEdit(rows, current, id, text));
            }}
            onRestore={() => {
              setFailure(null);
              setDraft(EMPTY_DRAFT);
            }}
          />
        </KeepPrevious>
      )}

      <SaveBar
        rows={rows}
        draft={draft}
        saving={saving}
        failure={failure}
        onSave={() => void save()}
        onDiscard={() => {
          setFailure(null);
          setDraft(EMPTY_DRAFT);
        }}
      />

      {planning ? (
        <PlanDialog
          onClose={() => setPlanning(false)}
          onPlan={onPlan}
          blocked={status.changed > 0}
        />
      ) : null}
    </div>
  );
};
