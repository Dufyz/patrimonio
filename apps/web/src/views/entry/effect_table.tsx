import {
  Money,
  MoneyChange,
  Percent,
  Points,
  Quantity,
} from '../../components/number.js';
import { Label } from '../../components/primitives.js';
import type { EffectRow, EffectUnit } from '../../lib/entry.js';
import { percentAsRatio } from '../../lib/overview.js';
import type { PreviewState } from './hooks.js';
import { previewValue } from './hooks.js';

/**
 * T-10 · "Efeito na posição": antes → depois.
 *
 * É a razão de os modais existirem. A tabela só desenha o que o preview da
 * `api` devolveu — o plano é o mesmo que grava, então "depois" é o que vai ficar
 * gravado — e nunca calcula nada. Enquanto um preview novo chega, o anterior
 * continua na tela, opaco: a tabela não pisca a cada tecla.
 */

const Value = ({
  unit,
  value,
}: {
  readonly unit: EffectUnit;
  readonly value: string | null;
}): React.ReactElement => {
  if (value === null) return <span className="text-ink-3">—</span>;

  switch (unit) {
    case 'quantity':
      return <Quantity value={value} />;
    case 'money':
      return <Money value={value} bare />;
    case 'signed_money':
      return <MoneyChange value={value} />;
    case 'percent':
      return <Percent value={percentAsRatio(value)} decimals={1} />;
  }
};

const Row = ({ row }: { readonly row: EffectRow }): React.ReactElement => {
  if (row.kind === 'allocation') {
    return (
      <tr className="border-t border-line">
        <th scope="row" className="px-3 py-2 text-left font-normal">
          {row.label}
        </th>
        <td className="px-3 py-2 text-right text-ink-2">
          <Percent value={percentAsRatio(row.currentBefore)} decimals={1} />
          {row.target === null ? null : (
            <>
              {' / '}
              <Percent value={percentAsRatio(row.target)} decimals={0} />
            </>
          )}
        </td>
        <td className="px-3 py-2 text-right font-semibold">
          <Percent value={percentAsRatio(row.currentAfter)} decimals={1} />
          {row.deviationAfter === null ? null : (
            <>
              {' · '}
              <Points value={row.deviationAfter} tone="attention" />
            </>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-line">
      <th scope="row" className="px-3 py-2 text-left font-normal">
        {row.label}
      </th>
      <td className="px-3 py-2 text-right text-ink-2">
        <Value unit={row.unit} value={row.before} />
      </td>
      <td className="px-3 py-2 text-right font-semibold">
        {row.unchanged ? (
          <span>sem mudança</span>
        ) : (
          <Value unit={row.unit} value={row.after} />
        )}
      </td>
    </tr>
  );
};

export const EffectTable = ({
  title = 'Efeito na posição',
  rows,
  busy,
}: {
  readonly title?: string;
  readonly rows: readonly EffectRow[];
  readonly busy: boolean;
}): React.ReactElement => (
  <table
    aria-busy={busy}
    className={`w-full overflow-hidden rounded-control border border-line text-sm transition-opacity ${
      busy ? 'opacity-60' : ''
    }`}
  >
    <caption className="sr-only">{title}</caption>
    <thead className="bg-panel-2">
      <tr>
        <th scope="col" className="px-3 py-1.5 text-left font-normal">
          <Label>{title}</Label>
        </th>
        <th scope="col" colSpan={2} className="px-3 py-1.5 text-right font-normal">
          <Label>Antes → depois</Label>
        </th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </tbody>
  </table>
);

/**
 * O que a área do efeito diz em cada estado do preview. Formulário incompleto
 * não é erro — é o estado inicial, e a mensagem diz o que falta para o efeito
 * aparecer, em vez de deixar um buraco.
 */
export const EffectPanel = <T,>({
  state,
  rows,
  idle,
  title,
}: {
  readonly state: PreviewState<T>;
  readonly rows: (value: T) => readonly EffectRow[];
  readonly idle: string;
  readonly title?: string;
}): React.ReactElement => {
  const value = previewValue(state);

  if (value !== null) {
    return (
      <EffectTable
        {...(title === undefined ? {} : { title })}
        rows={rows(value)}
        busy={state.status === 'loading'}
      />
    );
  }

  if (state.status === 'error') {
    return (
      <p
        role="alert"
        className="rounded-control bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative"
      >
        {state.message}
      </p>
    );
  }

  return (
    <p
      aria-busy={state.status === 'loading'}
      className="rounded-control border border-dashed border-line px-3 py-3 text-[0.8125rem] text-ink-3"
    >
      {state.status === 'loading' ? 'Calculando o efeito…' : idle}
    </p>
  );
};
