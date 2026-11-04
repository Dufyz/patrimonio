import type { GoalResource } from '@patrimonio/contracts';
import { useMemo, useState } from 'react';

import { previewGoal, putGoal } from '../../api/goals.js';
import { Money, Percent } from '../../components/number.js';
import { Modal } from '../../components/overlay.js';
import { Button } from '../../components/primitives.js';
import {
  ASSUMPTION_PRESETS,
  OTHER_ASSUMPTION,
  STATUS_LABEL,
  formFromGoal,
  goalFormResult,
  latenessOf,
  monthYearLabel,
} from '../../lib/goals.js';
import type { GoalForm } from '../../lib/goals.js';
import { percentAsRatio } from '../../lib/overview.js';
import { Callout, Field, Input, MoneyInput, Select } from '../entry/fields.js';
import { FormShell } from '../entry/form_shell.js';
import { previewValue, usePreview } from '../entry/hooks.js';
import { useSubmit } from './use_submit.js';

/**
 * A prancha 10 B: criar e editar objetivo.
 *
 * Um objetivo mede o valor de uma carteira ao longo do tempo e não guarda
 * ativos. Cada carteira tem no máximo um, então o mesmo formulário cria e edita
 * e a carteira não é um campo a escolher: é a da tela, e aparece só para dizer
 * o que está sendo medido.
 *
 * "Resultado" responde, antes de gravar, o que a pessoa vai querer saber: com
 * esta meta, quanto falta, quanto aportar e quando chega. O "depois" vem da
 * `api`, pela mesma conta da tela — o modal não faz conta —, e o "antes" é o
 * objetivo que a tela já mostra.
 */

const Row = ({
  label,
  before,
  after,
}: {
  readonly label: string;
  readonly before: React.ReactNode;
  readonly after: React.ReactNode;
}): React.ReactElement => (
  <tr className="border-t border-line">
    <th scope="row" className="px-3 py-2 text-left font-normal">
      {label}
    </th>
    <td className="px-3 py-2 text-center tabular text-ink-3">{before}</td>
    <td className="px-3 py-2 text-right font-semibold tabular">{after}</td>
  </tr>
);

const COLUMN =
  'px-3 py-2 tabular text-label font-medium tracking-[0.06em] text-ink-3 uppercase';

const ArrivalText = ({ goal }: { readonly goal: GoalResource }): React.ReactElement => {
  const projection = goal.projection;
  if (projection === null) return <>—</>;
  if (projection.arrival_date === null)
    return <span className="text-negative">não chega</span>;

  const lateness = latenessOf(projection.months_to_arrival, goal.months_remaining);

  return (
    <span className={lateness?.tone === 'positive' ? 'text-positive' : 'text-attention'}>
      {monthYearLabel(projection.arrival_date)}
    </span>
  );
};

const Result = ({
  before,
  after,
}: {
  readonly before: GoalResource | null;
  readonly after: GoalResource | null;
}): React.ReactElement => (
  <table className="w-full overflow-hidden rounded-panel border border-line text-[0.8125rem]">
    <caption className="sr-only">Resultado do objetivo</caption>
    <thead className="bg-panel-2">
      <tr>
        <th scope="col" className={`${COLUMN} text-left`}>
          Resultado
        </th>
        <th scope="col" className={`${COLUMN} text-center`}>
          Antes
        </th>
        <th scope="col" className={`${COLUMN} text-right`}>
          Depois
        </th>
      </tr>
    </thead>
    <tbody>
      <Row
        label="Progresso"
        before={
          before === null ? (
            '—'
          ) : (
            <Percent value={percentAsRatio(before.progress_pct)} decimals={1} />
          )
        }
        after={
          after === null ? (
            '—'
          ) : (
            <Percent value={percentAsRatio(after.progress_pct)} decimals={1} />
          )
        }
      />
      <Row
        label="Aporte mensal necessário"
        before={
          before?.projection == null ? (
            '—'
          ) : (
            <Money value={before.projection.required_monthly} decimals={0} />
          )
        }
        after={
          after?.projection == null ? (
            '—'
          ) : (
            <Money value={after.projection.required_monthly} decimals={0} />
          )
        }
      />
      <Row
        label="No ritmo atual"
        before={before === null ? '—' : <ArrivalText goal={before} />}
        after={after === null ? '—' : <ArrivalText goal={after} />}
      />
    </tbody>
  </table>
);

export const GoalDialog = ({
  portfolioId,
  scopeLabel,
  goal,
  onClose,
  onSaved,
  onDelete,
}: {
  readonly portfolioId: string;
  /** O nome da carteira que o objetivo mede. */
  readonly scopeLabel: string;
  /** `null` cria. */
  readonly goal: GoalResource | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly onDelete?: (() => void) | undefined;
}): React.ReactElement => {
  const [form, setForm] = useState<GoalForm>(() => formFromGoal(goal));
  const [attempted, setAttempted] = useState(false);

  const set = <K extends keyof GoalForm>(key: K, value: GoalForm[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const result = useMemo(() => goalFormResult(form, goal), [form, goal]);
  const errors = attempted ? result.errors : {};

  const preview = usePreview(
    result.body === null ? null : JSON.stringify(result.body),
    (signal) =>
      result.body === null
        ? Promise.reject(new Error('formulário inválido'))
        : previewGoal(portfolioId, result.body, signal),
  );
  const after = previewValue(preview);

  const { pending, error, submit } = useSubmit(
    () =>
      result.body === null
        ? Promise.reject(new Error('formulário inválido'))
        : putGoal(portfolioId, result.body),
    onSaved,
  );

  const save = (): void => {
    setAttempted(true);
    if (result.body !== null) submit();
  };

  const other = form.assumption === OTHER_ASSUMPTION;

  return (
    <Modal
      open
      guard
      narrow
      title={goal === null ? 'Novo objetivo' : 'Editar objetivo'}
      subtitle="Um objetivo mede o valor de uma carteira ao longo do tempo; não guarda ativos"
      onClose={onClose}
    >
      <FormShell
        pending={pending}
        error={error}
        onSave={save}
        onCancel={onClose}
        destructive={
          goal === null || onDelete === undefined ? undefined : (
            <Button variant="destructive" icon="trash" onClick={onDelete}>
              Excluir
            </Button>
          )
        }
      >
        <Field label="Nome" error={errors.name}>
          {(control) => (
            <Input
              {...control}
              data-autofocus
              invalid={errors.name !== undefined}
              value={form.name}
              placeholder="Independência financeira"
              onChange={(event) => set('name', event.target.value)}
            />
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Valor alvo" error={errors.amount}>
            {(control) => (
              <MoneyInput
                {...control}
                invalid={errors.amount !== undefined}
                value={form.amount}
                placeholder="400.000,00"
                onChange={(event) => set('amount', event.target.value)}
              />
            )}
          </Field>
          <Field label="Data" error={errors.date}>
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                className="tabular"
                invalid={errors.date !== undefined}
                value={form.date}
                placeholder="jun/2030"
                onChange={(event) => set('date', event.target.value)}
              />
            )}
          </Field>
          <Field label="Premissa de retorno" error={errors.assumption}>
            {(control) => (
              <Select
                {...control}
                invalid={errors.assumption !== undefined && !other}
                value={form.assumption}
                options={ASSUMPTION_PRESETS}
                onChange={(event) => set('assumption', event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Valores em"
            hint={
              form.valuesIn === 'today'
                ? 'corrigidos pelo IPCA'
                : 'valores nominais da data alvo'
            }
          >
            {(control) => (
              <Select
                {...control}
                invalid={false}
                value={form.valuesIn}
                options={[
                  { id: 'today', name: 'reais de hoje' },
                  { id: 'target', name: 'reais da data alvo' },
                ]}
                onChange={(event) =>
                  set('valuesIn', event.target.value === 'target' ? 'target' : 'today')
                }
              />
            )}
          </Field>
        </div>

        {other ? (
          <Field
            label="Premissa digitada"
            error={errors.assumption}
            hint="IPCA+6 para inflação mais 6% ao ano, ou 8 para uma taxa fixa"
          >
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                invalid={errors.assumption !== undefined}
                value={form.otherAssumption}
                placeholder="IPCA+6,5"
                onChange={(event) => set('otherAssumption', event.target.value)}
              />
            )}
          </Field>
        ) : null}

        <Field
          label="Carteira"
          hint={
            after === null ? undefined : (
              <>
                <Money value={after.current_value} /> hoje
                {after.as_of === null ? ' · carteira ainda não consolidada' : ''}
              </>
            )
          }
        >
          {(control) => (
            <Input {...control} readOnly disabled invalid={false} value={scopeLabel} />
          )}
        </Field>

        {preview.status === 'error' && result.body !== null ? (
          <Callout tone="warning">{preview.message}</Callout>
        ) : null}

        <Result before={goal} after={after} />

        {after !== null && after.projection === null ? (
          <p className="text-[0.75rem] text-ink-3">
            {STATUS_LABEL[after.status]}: não há projeção para esta meta.
          </p>
        ) : null}
      </FormShell>
    </Modal>
  );
};
