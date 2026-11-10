import { Money } from '../components/number.js';
import { Panel } from '../components/primitives.js';
import type { Rates } from '../lib/goal_rates.js';
import { useLiveRate } from '../lib/use_live_rate.js';
import { PercentInput } from './entry/fields.js';

/**
 * A rentabilidade esperada de cada carteira, a mesma tabela da Projeção: % ao
 * ano, digitada e aplicada na hora. A taxa é a da Projeção — mudar aqui muda lá
 * —, e carteira sem taxa usa a premissa do objetivo, que aparece como dica.
 */
export type RateRow = {
  readonly id: string;
  readonly name: string;
  readonly current_value: string;
  /** A premissa do objetivo como taxa nominal ao ano, para a dica do campo. */
  readonly premise_pct: string | null;
};

const TH =
  'tabular px-3 py-2.5 text-label font-normal tracking-[0.08em] text-ink-3 uppercase';

export const percentText = (value: string | null): string =>
  value === null
    ? '—'
    : `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

const RateInput = ({
  name,
  placeholder,
  applied,
  onCommit,
}: {
  readonly name: string;
  readonly placeholder: string;
  readonly applied: string | null;
  readonly onCommit: (rate: string | null) => void;
}): React.ReactElement => {
  const { draft, setDraft, invalid } = useLiveRate(applied, onCommit);

  return (
    <>
      <PercentInput
        aria-label={`Rentabilidade esperada · ${name}`}
        placeholder={placeholder}
        invalid={invalid}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      {invalid ? (
        <span role="alert" className="mt-0.5 block text-xs text-negative">
          Informe de 0 a 100.
        </span>
      ) : null}
    </>
  );
};

export const RatesPanel = ({
  rows,
  rates,
  onChange,
}: {
  readonly rows: readonly RateRow[];
  readonly rates: Rates;
  readonly onChange: (portfolioId: string, rate: string | null) => void;
}): React.ReactElement | null => {
  if (rows.length === 0) return null;

  return (
    <Panel
      title="Rentabilidade esperada"
      hint="ao ano, por carteira, a mesma da Projeção"
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-cell whitespace-nowrap">
          <caption className="sr-only">Rentabilidade esperada por carteira</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={`${TH} text-left`}>
                Carteira
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Hoje
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Rentabilidade (% ao ano)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-b-0">
                <td className="px-3 py-[var(--row-pad)] font-medium">{row.name}</td>
                <td className="tabular px-3 py-[var(--row-pad)] text-right">
                  <Money value={row.current_value} decimals={0} />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <span className="inline-block w-28 text-left">
                    <RateInput
                      name={row.name}
                      placeholder={
                        row.premise_pct === null
                          ? '0'
                          : percentText(row.premise_pct).replace('%', '')
                      }
                      applied={rates[row.id] ?? null}
                      onCommit={(rate) => onChange(row.id, rate)}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
};
