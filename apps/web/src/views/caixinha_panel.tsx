import type { AssetPageResource, GetCaixinhaResponse } from '@patrimonio/contracts';
import { useEffect, useState } from 'react';

import {
  fetchCaixinha,
  previewCaixinhaRedemption,
  redeemCaixinha,
} from '../api/caixinha.js';
import type { RedemptionBody } from '../api/caixinha.js';
import { createTransaction } from '../api/entry.js';
import { Money } from '../components/number.js';
import { Modal } from '../components/overlay.js';
import { Button, Panel } from '../components/primitives.js';
import { SkeletonLines, SkeletonRegion } from '../components/skeleton.js';
import { newAttemptKey, todayDateOnly } from '../lib/entry.js';
import { parseAmountInput } from '../lib/positions.js';
import { formatDate } from '../lib/overview.js';
import { useResource } from '../lib/use_resource.js';
import { Field, Input, MoneyInput } from './entry/fields.js';

/**
 * A caixinha na página do ativo (prancha 20).
 *
 * Um ativo só, e cada aporte é um lote com a própria data. O painel mostra os
 * lotes abertos com o valor e o IR que cada um teria **se fosse resgatado hoje**
 * — a alíquota é a do prazo do lote, e é por isso que dois lotes da mesma caixinha
 * pagam alíquotas diferentes. O resgate mostra, antes de gravar, quais lotes
 * serão consumidos, pela regra da caixinha, e quanto cai na conta.
 *
 * Nenhum número é calculado aqui: lote, rendimento, IR e consumo chegam da `api`.
 */
const RULE_LABELS = {
  oldest_first: 'o lote mais antigo primeiro',
  newest_first: 'o lote mais novo primeiro',
} as const;

type Dialog = 'contribute' | 'redeem' | null;

/** Soma meses a uma data, sem passar do fim do mês (31/01 + 1 mês = 28/02). */
const addMonths = (date: string, months: number): string => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const last = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return [
    String(targetYear).padStart(4, '0'),
    String(targetMonth).padStart(2, '0'),
    String(Math.min(day, last)).padStart(2, '0'),
  ].join('-');
};

const termsHint = (asset: AssetPageResource['asset']): string => {
  const vence =
    asset.maturity_date !== null
      ? `a caixinha vence em ${formatDate(asset.maturity_date)} e os lotes vencem junto`
      : asset.lot_term_months !== null
        ? `cada lote vence ${asset.lot_term_months} meses depois do aporte`
        : 'sem vencimento';
  const liquidez =
    asset.liquidity === 'at_maturity'
      ? 'resgate só de lote vencido'
      : 'resgate de qualquer lote';
  return `${vence} · ${liquidez}`;
};

export const CaixinhaPanel = ({
  portfolioId,
  asset,
  reloadKey,
  onChanged,
}: {
  readonly portfolioId: string;
  readonly asset: AssetPageResource['asset'];
  readonly reloadKey: number;
  readonly onChanged: () => void;
}): React.ReactElement => {
  const lots = useResource(
    (signal) => fetchCaixinha(portfolioId, asset.asset_id, signal),
    [portfolioId, asset.asset_id, reloadKey],
  );
  const [dialog, setDialog] = useState<Dialog>(null);

  const rule = asset.redemption_rule;

  return (
    <>
      <Panel
        title="Lotes da caixinha"
        hint={
          rule === null
            ? undefined
            : `${termsHint(asset)} · o resgate consome ${RULE_LABELS[rule]} · IR estimado se resgatado hoje`
        }
        action={
          <div className="flex gap-2">
            <Button onClick={() => setDialog('contribute')}>Aportar</Button>
            <Button onClick={() => setDialog('redeem')}>Resgatar</Button>
          </div>
        }
      >
        {lots.state.kind === 'loading' ? (
          <SkeletonRegion label="Carregando os lotes" className="px-4 py-3">
            <SkeletonLines lines={4} />
          </SkeletonRegion>
        ) : lots.state.kind === 'error' ? (
          <div role="alert" className="flex flex-col gap-3 px-4 py-3">
            <p className="text-sm text-negative">{lots.state.error.message}</p>
            <div>
              <Button onClick={lots.reload}>Tentar de novo</Button>
            </div>
          </div>
        ) : (
          <LotsTable view={lots.state.value} />
        )}
      </Panel>

      {dialog === 'contribute' ? (
        <ContributeDialog
          portfolioId={portfolioId}
          asset={asset}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            onChanged();
          }}
        />
      ) : null}

      {dialog === 'redeem' ? (
        <RedeemDialog
          portfolioId={portfolioId}
          asset={asset}
          available={lots.state.kind === 'ready' ? lots.state.value.gross_value : null}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
};

const LotsTable = ({
  view,
}: {
  readonly view: GetCaixinhaResponse;
}): React.ReactElement => {
  if (view.lots.length === 0) {
    return (
      <p className="px-4 py-8 text-[0.8125rem] text-ink-3">
        A caixinha ainda não tem aporte aberto.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-[0.8125rem]">
        <caption className="sr-only">Lotes abertos da caixinha</caption>
        <thead>
          <tr className="tabular text-label tracking-[0.06em] text-ink-3 uppercase">
            <th className="w-44 px-4 py-2 text-left font-medium">Aporte</th>
            <th className="px-3 py-2 text-right font-medium">Dias</th>
            <th className="px-3 py-2 text-left font-medium">Vencimento</th>
            <th className="px-3 py-2 text-right font-medium">Principal</th>
            <th className="px-3 py-2 text-right font-medium">Valor bruto</th>
            <th className="px-3 py-2 text-right font-medium">Rendimento</th>
            <th className="px-3 py-2 text-right font-medium">Alíquota</th>
            <th className="px-4 py-2 text-right font-medium">Líquido</th>
          </tr>
        </thead>
        <tbody>
          {view.lots.map((lot) => (
            <tr key={lot.id} className="border-t border-line hover:bg-panel-2">
              <td className="tabular px-4 py-2.5 whitespace-nowrap">
                {formatDate(lot.trade_date)}
                {lot.settled ? null : (
                  <span className="text-ink-3">
                    {' '}
                    · liquida em {formatDate(lot.settlement_date)}
                  </span>
                )}
              </td>
              <td className="tabular px-3 py-2.5 text-right text-ink-2">
                {lot.elapsed_days}
              </td>
              <td className="tabular px-3 py-2.5 whitespace-nowrap">
                {lot.maturity_date === null ? (
                  <span className="text-ink-3">—</span>
                ) : (
                  <>
                    {formatDate(lot.maturity_date)}
                    <span className="text-ink-3">
                      {lot.matured ? ' · vencido' : ''}
                      {lot.settled && !lot.redeemable ? ' · bloqueado' : ''}
                    </span>
                  </>
                )}
              </td>
              <td className="px-3 py-2.5 text-right">
                <Money value={lot.remaining} />
              </td>
              <td className="px-3 py-2.5 text-right">
                <Money value={lot.gross_value} />
              </td>
              <td className="px-3 py-2.5 text-right">
                <Money value={lot.accrued_interest} />
              </td>
              <td className="tabular px-3 py-2.5 text-right text-ink-2">
                {lot.tax_rate.replace('.', ',')}%
              </td>
              <td className="px-4 py-2.5 text-right">
                <Money value={lot.net_value} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-semibold">
            <td className="px-4 py-2.5">Total</td>
            <td />
            <td />
            <td className="px-3 py-2.5 text-right">
              <Money value={view.principal} />
            </td>
            <td className="px-3 py-2.5 text-right">
              <Money value={view.gross_value} />
            </td>
            <td />
            <td className="px-3 py-2.5 text-right text-ink-2">
              <Money value={view.tax_due} />
            </td>
            <td className="px-4 py-2.5 text-right">
              <Money value={view.net_value} />
            </td>
          </tr>
        </tfoot>
      </table>
      {view.incomplete ? (
        <p className="border-t border-line px-4 py-2.5 text-[0.8125rem] text-attention">
          Há dias úteis sem o índice publicado: o valor é o melhor disponível.
        </p>
      ) : null}
    </div>
  );
};

const ContributeDialog = ({
  portfolioId,
  asset,
  onClose,
  onSaved,
}: {
  readonly portfolioId: string;
  readonly asset: AssetPageResource['asset'];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): React.ReactElement => {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => todayDateOnly());
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptKey] = useState(() => newAttemptKey());

  // Só a caixinha cujos lotes vencem pede o vencimento do lote: o prazo padrão
  // preenche, e quem aporta troca se o banco deu outro. Quando a própria
  // caixinha vence, o lote herda esse vencimento e não há o que informar.
  const term = asset.lot_term_months;
  const [lotMaturity, setLotMaturity] = useState<string | null>(null);
  const suggestedMaturity = term === null ? null : addMonths(date, term);
  const maturity = lotMaturity ?? suggestedMaturity;

  const parsed = parseAmountInput(amount);
  const amountError =
    parsed === null || Number(parsed) <= 0 ? 'Informe o valor do aporte.' : undefined;
  const maturityError =
    maturity !== null && maturity <= date
      ? 'O vencimento do lote vem depois do aporte.'
      : asset.maturity_date !== null && date > asset.maturity_date
        ? `A caixinha venceu em ${formatDate(asset.maturity_date)}.`
        : undefined;

  const submit = (): void => {
    setAttempted(true);
    if (
      amountError !== undefined ||
      maturityError !== undefined ||
      parsed === null ||
      asset.issuer_id === null
    )
      return;

    setSaving(true);
    setError(null);

    // Na caixinha a quantidade é o valor aplicado e o preço é sempre 1,00.
    createTransaction(
      {
        kind: 'buy',
        portfolio_id: portfolioId,
        institution_id: asset.issuer_id ?? '',
        asset_id: asset.asset_id,
        trade_date: date,
        quantity: parsed,
        unit_price: '1',
        // Só o vencimento trocado à mão vai no aporte; o padrão a api calcula.
        ...(lotMaturity === null ? {} : { maturity_date: lotMaturity }),
      } as Parameters<typeof createTransaction>[0],
      attemptKey,
    )
      .then(onSaved)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'A api não respondeu'),
      )
      .finally(() => setSaving(false));
  };

  return (
    <Modal
      open
      guard
      narrow
      title="Aportar na caixinha"
      subtitle={asset.name}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={saving} onClick={submit}>
            {saving ? 'Aportando…' : 'Aportar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Valor" error={attempted ? amountError : undefined}>
          {(control) => (
            <MoneyInput
              {...control}
              numeric
              inputMode="decimal"
              invalid={control['aria-invalid']}
              value={amount}
              placeholder="1.000,00"
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </Field>
        <Field label="Data do aporte">
          {(control) => (
            <Input
              {...control}
              type="date"
              invalid={control['aria-invalid']}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          )}
        </Field>
        {term === null ? null : (
          <Field
            label="Vencimento do lote"
            error={attempted ? maturityError : undefined}
            hint={`Padrão: ${term} meses depois do aporte. Troque se o banco informou outra data.`}
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                invalid={control['aria-invalid']}
                value={maturity ?? ''}
                onChange={(event) => setLotMaturity(event.target.value)}
              />
            )}
          </Field>
        )}
        {term === null && attempted && maturityError !== undefined ? (
          <p role="alert" className="text-sm text-negative">
            {maturityError}
          </p>
        ) : null}
        <p className="text-[0.8125rem] text-ink-3">
          O aporte vira um lote novo, com a própria data: ele rende e paga IR pelo prazo
          dele, não pelo da caixinha. Ele rende desde o dia do aporte e fica disponível
          para resgate na data de liquidação do lançamento, que é a do aporte a menos que
          você a edite (o Itaú, por exemplo, libera no dia útil seguinte).
        </p>
        {error === null ? null : (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};

const RedeemDialog = ({
  portfolioId,
  asset,
  available,
  onClose,
  onSaved,
}: {
  readonly portfolioId: string;
  readonly asset: AssetPageResource['asset'];
  readonly available: string | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): React.ReactElement => {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => todayDateOnly());
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptKey] = useState(() => newAttemptKey());
  const [plan, setPlan] = useState<
    | { readonly kind: 'idle' }
    | {
        readonly kind: 'ready';
        readonly value: Awaited<ReturnType<typeof previewCaixinhaRedemption>>;
      }
    | { readonly kind: 'error'; readonly message: string }
  >({ kind: 'idle' });

  const parsed = parseAmountInput(amount);
  const body: RedemptionBody | null =
    parsed !== null && Number(parsed) > 0 ? { trade_date: date, amount: parsed } : null;
  const bodyKey = body === null ? null : JSON.stringify(body);

  // A prévia acompanha o que foi digitado: quais lotes saem e quanto cai na conta.
  useEffect(() => {
    if (bodyKey === null) {
      setPlan({ kind: 'idle' });
      return;
    }

    const controller = new AbortController();
    previewCaixinhaRedemption(
      portfolioId,
      asset.asset_id,
      JSON.parse(bodyKey) as RedemptionBody,
      controller.signal,
    )
      .then((value) => setPlan({ kind: 'ready', value }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setPlan({
          kind: 'error',
          message: cause instanceof Error ? cause.message : 'A api não respondeu',
        });
      });

    return () => controller.abort();
  }, [bodyKey, portfolioId, asset.asset_id]);

  const insufficient = plan.kind === 'ready' && plan.value.insufficient;
  const amountError =
    parsed === null || Number(parsed) <= 0
      ? 'Informe o valor a resgatar.'
      : insufficient
        ? 'Maior do que a caixinha tem disponível.'
        : undefined;

  const submit = (): void => {
    setAttempted(true);
    if (body === null || insufficient) return;

    setSaving(true);
    setError(null);

    redeemCaixinha(portfolioId, asset.asset_id, body, attemptKey)
      .then(onSaved)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'A api não respondeu'),
      )
      .finally(() => setSaving(false));
  };

  return (
    <Modal
      open
      guard
      title="Resgatar da caixinha"
      subtitle={asset.name}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={saving || plan.kind !== 'ready' || insufficient}
            onClick={submit}
          >
            {saving ? 'Resgatando…' : 'Resgatar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Valor bruto"
            error={attempted || insufficient ? amountError : undefined}
            hint={
              available === null ? undefined : (
                <>
                  Disponível: <Money value={available} />
                </>
              )
            }
          >
            {(control) => (
              <MoneyInput
                {...control}
                numeric
                inputMode="decimal"
                invalid={control['aria-invalid']}
                value={amount}
                placeholder="500,00"
                onChange={(event) => setAmount(event.target.value)}
              />
            )}
          </Field>
          <Field label="Data do resgate">
            {(control) => (
              <Input
                {...control}
                type="date"
                invalid={control['aria-invalid']}
                value={date}
                max={todayDateOnly()}
                onChange={(event) => setDate(event.target.value)}
              />
            )}
          </Field>
        </div>

        <div aria-live="polite" className="rounded-panel border border-line bg-panel-2">
          {plan.kind === 'idle' ? (
            <p className="px-4 py-3 text-[0.8125rem] text-ink-3">
              Informe o valor para ver quais lotes serão consumidos e quanto cai na conta.
            </p>
          ) : plan.kind === 'error' ? (
            <p role="alert" className="px-4 py-3 text-[0.8125rem] text-negative">
              {plan.message}
            </p>
          ) : plan.value.insufficient ? (
            <p className="px-4 py-3 text-[0.8125rem] text-negative">
              A caixinha tem <Money value={plan.value.available_gross} /> em{' '}
              {formatDate(date)}.
            </p>
          ) : (
            <table className="w-full text-[0.8125rem]">
              <caption className="sr-only">Lotes consumidos pelo resgate</caption>
              <thead>
                <tr className="tabular text-label tracking-[0.06em] text-ink-3 uppercase">
                  <th className="px-4 py-2 text-left font-medium">Lote</th>
                  <th className="px-3 py-2 text-right font-medium">Bruto</th>
                  <th className="px-3 py-2 text-right font-medium">IR</th>
                  <th className="px-4 py-2 text-right font-medium">Líquido</th>
                </tr>
              </thead>
              <tbody>
                {plan.value.slices.map((slice) => (
                  <tr key={slice.lot_id} className="border-t border-line">
                    <td className="tabular px-4 py-2 whitespace-nowrap">
                      {formatDate(slice.trade_date)}
                      <span className="text-ink-3">
                        {slice.closes_lot ? ' · fecha o lote' : ' · parcial'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Money value={slice.gross_value} />
                    </td>
                    <td className="px-3 py-2 text-right text-ink-2">
                      <Money value={slice.tax_due} />
                      <span className="text-ink-3">
                        {' '}
                        · {slice.tax_rate.replace('.', ',')}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money value={slice.net_value} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line font-semibold">
                  <td className="px-4 py-2">Cai na conta</td>
                  <td className="px-3 py-2 text-right">
                    <Money value={plan.value.gross_value} />
                  </td>
                  <td className="px-3 py-2 text-right text-ink-2">
                    <Money value={plan.value.tax_due} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money value={plan.value.net_value} />
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {error === null ? null : (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};
