import type { AssetResource } from '@patrimonio/contracts';

import { Label, Segmented } from '../../components/primitives.js';
import { Field, Input } from '../entry/fields.js';

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
    <div className="flex flex-col gap-4 rounded-panel border border-line bg-panel-2 p-4">
      <div className="flex flex-col gap-1.5">
        <Label>Vencimento</Label>
        <Segmented
          label="Vencimento"
          options={EXPIRIES}
          value={form.expiry}
          onChange={(expiry) => set({ expiry })}
        />
        <p className="text-xs text-ink-3">
          {form.expiry === 'asset'
            ? 'Todos os lotes vencem junto com a caixinha, e o aporte só vale até lá.'
            : form.expiry === 'lot'
              ? 'A caixinha segue aberta; cada aporte vence no prazo abaixo, ajustável na hora de aportar.'
              : 'Nem a caixinha nem os lotes têm vencimento.'}
        </p>
      </div>

      {form.expiry === 'asset' ? (
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
      ) : null}

      {form.expiry === 'lot' ? (
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
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Liquidez</Label>
          <Segmented
            label="Liquidez"
            options={LIQUIDITIES}
            value={form.liquidity}
            onChange={(liquidity) => set({ liquidity })}
          />
          <p className="text-xs text-ink-3">
            {form.liquidity === 'daily'
              ? 'O resgate alcança qualquer lote, vencido ou não.'
              : 'O resgate só alcança lote já vencido.'}
          </p>
          {attempted && errors.liquidity !== undefined ? (
            <p className="text-[0.71875rem] text-negative">{errors.liquidity}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Resgate consome</Label>
          <Segmented
            label="Resgate consome"
            options={RULES}
            value={form.rule}
            onChange={(rule) => set({ rule })}
          />
          <p className="text-xs text-ink-3">
            Confira no extrato do banco qual lote ele debita.
          </p>
        </div>
      </div>
    </div>
  );
};
