import type { EffectRow as FinanceEffectRow } from '../finance/domain/effects.js';
import { formatBRL } from '../finance/lib/format.js';
import type { EffectRow, EffectUnit } from '../lib/entry.js';
import { percentAsRatio } from '../lib/overview.js';
import type { PreviewState } from '../views/entry/hooks.js';
import { previewValue } from '../views/entry/hooks.js';
import { Money, MoneyChange, Percent, Points, Quantity } from './number.js';
import { Label } from './primitives.js';

/**
 * CMP-09 · Bloco "Efeito": antes → depois. Único componente do app: atende os
 * modais de lançamento do fluxo (linhas em centavos) e os de carteira (linhas
 * que o preview da `api` devolveu).
 *
 * Antes era um por área; o teste de convenções falha se surgir outro.
 *
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
      return <Money value={value} />;
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

export type AnyEffectRow = EffectRow | FinanceEffectRow;

const isFinanceRow = (row: AnyEffectRow): row is FinanceEffectRow => !('kind' in row);

const FinanceRow = ({ row }: { readonly row: FinanceEffectRow }): React.ReactElement => (
  <tr className="border-t border-line">
    <th scope="row" className="px-3 py-2 text-left font-normal">
      {row.label}
      {row.hint === undefined ? null : (
        <span className="ml-1.5 text-xs text-ink-3">{row.hint}</span>
      )}
    </th>
    <td className="tabular px-3 py-2 text-right text-ink-3">{formatBRL(row.before)}</td>
    <td className="tabular px-3 py-2 text-right font-semibold">
      <span aria-hidden="true" className="mr-1.5 text-ink-3">
        →
      </span>
      <span className="sr-only">para </span>
      {formatBRL(row.after)}
    </td>
  </tr>
);

export const EffectTable = ({
  title = 'Efeito',
  rows,
  busy = false,
}: {
  readonly title?: string;
  readonly rows: readonly AnyEffectRow[];
  readonly busy?: boolean;
}): React.ReactElement | null => {
  // Linhas do fluxo que não mudam somem: o bloco não repete o óbvio, e sem
  // nenhuma mudança o bloco inteiro some.
  const shown = rows.filter((row) => !isFinanceRow(row) || row.before !== row.after);
  if (shown.length === 0) return null;
  return (
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
        {shown.map((row) =>
          isFinanceRow(row) ? (
            <FinanceRow key={`${row.label}-${row.hint ?? ''}`} row={row} />
          ) : (
            <Row key={row.id} row={row} />
          ),
        )}
      </tbody>
    </table>
  );
};

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
  readonly rows: (value: T) => readonly AnyEffectRow[];
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
