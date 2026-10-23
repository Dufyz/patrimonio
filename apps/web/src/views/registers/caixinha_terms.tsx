import type { AssetResource } from '@patrimonio/contracts';

import { Segmented } from '../../components/primitives.js';
import { Field, Input, FieldLabel } from '../entry/fields.js';

/**
 * As condições que só a caixinha tem, compartilhadas pelo cadastro e pela edição.
 *
 * A caixinha é um agregador de lotes, e o vencimento aparece de dois jeitos:
 *
 * - **a caixinha vence como um todo** (a Turbo do Nubank, que vence todo ano):
 *   os lotes herdam o vencimento, e o aporte só existe até ele;
 * - **a caixinha não vence, os lotes sim** (a do Itaú, em que cada aporte vence
 *   em cinco anos): o prazo padrão preenche o vencimento de cada aporte, que
 *   ainda pode ser trocado na hora de aportar.
 *
 * A liquidez diz se o resgate alcança o lote antes do vencimento.
 */
export type Rule = 'oldest_first' | 'newest_first';
export type Expiry = 'asset' | 'lot' | 'none';
export type CaixinhaLiquidity = 'daily' | 'at_maturity';

export type CaixinhaForm = {
  readonly rule: Rule;
  readonly expiry: Expiry;
  readonly maturity: string;
  readonly term: string;
  readonly liquidity: CaixinhaLiquidity;
};

export const EMPTY_CAIXINHA: CaixinhaForm = {
  rule: 'oldest_first',
  expiry: 'none',
  maturity: '',
  term: '',
  liquidity: 'daily',
};

export const caixinhaFormOf = (
  asset:
    | AssetResource
    | {
        readonly redemption_rule: Rule | null;
        readonly maturity_date: string | null;
        readonly lot_term_months: number | null;
        readonly liquidity: string | null;
      },
): CaixinhaForm => ({
  rule: asset.redemption_rule ?? 'oldest_first',
  expiry:
    asset.maturity_date !== null
      ? 'asset'
      : asset.lot_term_months !== null
        ? 'lot'
        : 'none',
  maturity: asset.maturity_date ?? '',
  term: asset.lot_term_months === null ? '' : String(asset.lot_term_months),
  liquidity: asset.liquidity === 'at_maturity' ? 'at_maturity' : 'daily',
});

export const caixinhaErrors = (
  form: CaixinhaForm,
  issuedAt: string,
): {
  readonly maturity?: string;
  readonly term?: string;
  readonly liquidity?: string;
} => ({
  ...(form.expiry === 'asset' && form.maturity === ''
    ? { maturity: 'Informe o vencimento da caixinha.' }
    : form.expiry === 'asset' && issuedAt !== '' && form.maturity <= issuedAt
      ? { maturity: 'O vencimento vem depois da abertura.' }
      : {}),
  ...(form.expiry === 'lot' && !/^[1-9]\d*$/.test(form.term.trim())
    ? { term: 'Informe o prazo em meses.' }
    : {}),
  ...(form.liquidity === 'at_maturity' && form.expiry === 'none'
    ? { liquidity: 'Liquidez no vencimento precisa de um vencimento.' }
    : {}),
});

/** O corpo do cadastro: só os campos que existem para o modelo escolhido. */
export const caixinhaBody = (form: CaixinhaForm) => ({
  redemption_rule: form.rule,
  liquidity: form.liquidity,
  ...(form.expiry === 'asset' ? { maturity_date: form.maturity } : {}),
  ...(form.expiry === 'lot' ? { lot_term_months: Number(form.term) } : {}),
});

/** O ajuste da edição: o que não vale mais é zerado explicitamente. */
export const caixinhaPatch = (form: CaixinhaForm) => ({
  redemption_rule: form.rule,
  liquidity: form.liquidity,
  liquidity_days: null,
  maturity_date: form.expiry === 'asset' ? form.maturity : null,
  lot_term_months: form.expiry === 'lot' ? Number(form.term) : null,
});

const RULES: readonly { value: Rule; label: string }[] = [
  { value: 'oldest_first', label: 'Mais antigo primeiro' },
  { value: 'newest_first', label: 'Mais novo primeiro' },
];

const EXPIRIES: readonly { value: Expiry; label: string }[] = [
  { value: 'asset', label: 'A caixinha vence' },
  { value: 'lot', label: 'Cada lote vence' },
  { value: 'none', label: 'Não vence' },
];

const LIQUIDITIES: readonly { value: CaixinhaLiquidity; label: string }[] = [
  { value: 'daily', label: 'Diária' },
  { value: 'at_maturity', label: 'No vencimento' },
];

export const CaixinhaFields = ({
  form,
  onChange,
  attempted,
  issuedAt,
}: {
  readonly form: CaixinhaForm;
  readonly onChange: (form: CaixinhaForm) => void;
  readonly attempted: boolean;
  readonly issuedAt: string;
}): React.ReactElement => {
  const errors = caixinhaErrors(form, issuedAt);
  const set = (changes: Partial<CaixinhaForm>): void => onChange({ ...form, ...changes });

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>Regras dos lotes</FieldLabel>
      <div className="flex flex-col divide-y divide-line rounded-panel border border-line-2">
        <TermRow
          title="Vencimento"
          hint={
            form.expiry === 'asset'
              ? 'Todos os lotes vencem junto com a caixinha, e o aporte só vale até lá.'
              : form.expiry === 'lot'
                ? 'Cada aporte carrega o próprio vencimento, ajustável na hora de aportar.'
                : 'Nem a caixinha nem os lotes têm vencimento.'
          }
        >
          <Segmented
            label="Vencimento"
            options={EXPIRIES}
            value={form.expiry}
            onChange={(expiry) => set({ expiry })}
          />
        </TermRow>

        {form.expiry === 'asset' ? (
          <div className="px-4 py-3">
            <Field
              label="Vencimento da caixinha"
              error={attempted ? errors.maturity : undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  invalid={attempted && errors.maturity !== undefined}
                  value={form.maturity}
                  onChange={(event) => set({ maturity: event.target.value })}
                />
              )}
            </Field>
          </div>
        ) : null}

        {form.expiry === 'lot' ? (
          <div className="px-4 py-3">
            <Field
              label="Prazo de cada lote (meses)"
              error={attempted ? errors.term : undefined}
              hint="60 meses = lotes que vencem 5 anos depois do aporte."
            >
              {(control) => (
                <Input
                  {...control}
                  numeric
                  inputMode="numeric"
                  invalid={attempted && errors.term !== undefined}
                  value={form.term}
                  onChange={(event) => set({ term: event.target.value })}
                />
              )}
            </Field>
          </div>
        ) : null}

        <TermRow
          title="Liquidez"
          hint={
            form.liquidity === 'daily'
              ? 'Resgate disponível em qualquer dia útil.'
              : 'O resgate só alcança lote já vencido.'
          }
        >
          <Segmented
            label="Liquidez"
            options={LIQUIDITIES}
            value={form.liquidity}
            onChange={(liquidity) => set({ liquidity })}
          />
        </TermRow>
        {attempted && errors.liquidity !== undefined ? (
          <p className="px-4 py-2 text-[0.71875rem] text-negative">{errors.liquidity}</p>
        ) : null}

        <TermRow
          title="Resgate consome"
          hint="Define quais lotes são baixados primeiro, o imposto e o saldo restante."
        >
          <Segmented
            label="Resgate consome"
            options={RULES}
            value={form.rule}
            onChange={(rule) => set({ rule })}
          />
        </TermRow>
      </div>
    </div>
  );
};

const TermRow = ({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
    <div className="min-w-0 flex-1 basis-48">
      <div className="text-[0.8125rem] font-semibold">{title}</div>
      <div className="text-xs text-ink-3">{hint}</div>
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);
