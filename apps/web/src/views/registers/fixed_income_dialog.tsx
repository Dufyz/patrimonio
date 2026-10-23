import type { AssetResource, InstitutionResource } from '@patrimonio/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchInstitutions } from '../../api/institutions.js';
import { createFixedIncomeAsset } from '../../api/registers.js';
import type { FixedIncomeBody } from '../../api/registers.js';
import { Modal } from '../../components/overlay.js';
import { Button, Segmented } from '../../components/primitives.js';
import { Field, Input, Select, FieldLabel } from '../entry/fields.js';
import { FormShell } from '../entry/form_shell.js';
import {
  CaixinhaFields,
  EMPTY_CAIXINHA,
  caixinhaBody,
  caixinhaErrors,
} from './caixinha_terms.js';
import type { CaixinhaForm } from './caixinha_terms.js';
import { useSubmit } from './use_submit.js';

/**
 * A prancha 14 B: cadastrar um título de renda fixa.
 *
 * Ações, FIIs, ETFs e Tesouro vêm da base de mercado e entram no primeiro
 * lançamento; só o título bancário e o crédito privado — que não têm cotação
 * pública — são cadastrados à mão, com emissor, indexador, taxa e vencimento. A
 * categoria não é escolhida: o tipo do título a define no catálogo da
 * plataforma, e a pastilha no pé do formulário diz qual ela vai ser.
 */

type Kind = FixedIncomeBody['kind'];
type Indexer = FixedIncomeBody['indexer'];
type Liquidity = FixedIncomeBody['liquidity'];
type Tax = FixedIncomeBody['tax_regime'];

const KINDS: readonly { value: Kind; label: string }[] = [
  { value: 'cdb', label: 'CDB' },
  { value: 'lci', label: 'LCI' },
  { value: 'lca', label: 'LCA' },
  { value: 'debenture', label: 'Debênture' },
  { value: 'cri', label: 'CRI' },
  { value: 'cra', label: 'CRA' },
  { value: 'outro', label: 'Outro' },
];

export const INDEXERS: readonly { value: Indexer; label: string }[] = [
  { value: 'cdi_pct', label: '% do CDI' },
  { value: 'ipca_plus', label: 'IPCA +' },
  { value: 'prefixed', label: 'Prefixado' },
  { value: 'selic_plus', label: 'Selic +' },
];

export const LIQUIDITIES: readonly { value: Liquidity; label: string }[] = [
  { value: 'daily', label: 'Diária' },
  { value: 'at_maturity', label: 'No vencimento' },
  { value: 'd_plus_n', label: 'D+n' },
];

const MODELS: readonly { value: 'title' | 'caixinha'; label: string }[] = [
  { value: 'title', label: 'Título único' },
  { value: 'caixinha', label: 'Caixinha (aportes em lotes)' },
];

export const TAXES: readonly { value: Tax; label: string }[] = [
  { value: 'regressive', label: 'Tabela regressiva' },
  { value: 'exempt', label: 'Isento' },
];

const CLASS_BY_KIND: Readonly<Record<Kind, { token: string; label: string }>> = {
  cdb: { token: 'class.rf-pos', label: 'CDB' },
  lci: { token: 'class.rf-pos', label: 'LCA / LCI / LCD' },
  lca: { token: 'class.rf-pos', label: 'LCA / LCI / LCD' },
  debenture: { token: 'class.rf-inflacao', label: 'Debêntures' },
  cri: { token: 'class.rf-inflacao', label: 'CRI / CRA' },
  cra: { token: 'class.rf-inflacao', label: 'CRI / CRA' },
  outro: { token: 'class.outros', label: 'Ativos Personalizados' },
};

export const RATE_SUFFIX: Readonly<Record<Indexer, string>> = {
  cdi_pct: '% CDI',
  ipca_plus: '% a.a.',
  prefixed: '% a.a.',
  selic_plus: '% a.a.',
};

export const parseRate = (text: string): string | null => {
  const normalized = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(normalized) ? normalized : null;
};

const monthYear = (iso: string): string =>
  iso.length >= 7 ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';

export const FixedIncomeDialog = ({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (asset: AssetResource) => void;
}): React.ReactElement => {
  const [institutions, setInstitutions] = useState<readonly InstitutionResource[]>([]);
  const [kind, setKind] = useState<Kind>('cdb');
  const [issuer, setIssuer] = useState('');
  const [indexer, setIndexer] = useState<Indexer>('cdi_pct');
  const [rate, setRate] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [maturity, setMaturity] = useState('');
  const [liquidity, setLiquidity] = useState<Liquidity>('at_maturity');
  const [liquidityDays, setLiquidityDays] = useState('');
  const [tax, setTax] = useState<Tax>('regressive');
  const [model, setModel] = useState<'title' | 'caixinha'>('title');
  const [terms, setTerms] = useState<CaixinhaForm>(EMPTY_CAIXINHA);
  const [name, setName] = useState('');
  const [attempted, setAttempted] = useState(false);
  const created = useRef<AssetResource | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchInstitutions(controller.signal)
      .then(setInstitutions)
      .catch(() => {
        // Sem a lista o campo fica vazio e o erro aparece ao salvar.
      });
    return () => controller.abort();
  }, []);

  // A caixinha pode vencer como um todo, ter lotes que vencem ou não vencer;
  // os campos disso ficam em `terms`.
  const caixinha = kind === 'cdb' && model === 'caixinha';

  const issuerName = institutions.find((item) => item.id === issuer)?.name ?? '';
  const suggested = useMemo(() => {
    const label = KINDS.find((item) => item.value === kind)?.label ?? '';
    const rateText = parseRate(rate);
    const spec = INDEXERS.find((item) => item.value === indexer)?.label ?? '';
    return [
      caixinha ? `Caixinha ${issuerName}`.trim() : `${label} ${issuerName}`.trim(),
      caixinha
        ? terms.expiry === 'asset'
          ? monthYear(terms.maturity)
          : ''
        : monthYear(maturity),
      rateText === null ? null : `${rateText.replace('.', ',')} ${spec}`,
    ]
      .filter((part) => part !== null && part !== '')
      .join(' · ')
      .replace(' · ', ' ');
  }, [kind, issuerName, maturity, rate, indexer, caixinha, terms]);

  const errors = {
    issuer: issuer === '' ? 'Escolha o emissor.' : undefined,
    rate: parseRate(rate) === null ? 'Informe a taxa, como 112,00.' : undefined,
    issuedAt: issuedAt === '' ? 'Informe a data da aplicação.' : undefined,
    maturity: caixinha
      ? undefined
      : maturity === ''
        ? 'Informe o vencimento.'
        : issuedAt !== '' && maturity <= issuedAt
          ? 'O vencimento vem depois da aplicação.'
          : undefined,
    days:
      !caixinha && liquidity === 'd_plus_n' && !/^[1-9]\d*$/.test(liquidityDays.trim())
        ? 'Informe os dias.'
        : undefined,
  };
  const caixinhaProblems = caixinha ? caixinhaErrors(terms, issuedAt) : {};
  const valid =
    Object.values(errors).every((error) => error === undefined) &&
    Object.values(caixinhaProblems).every((error) => error === undefined);

  const { pending, error, submit } = useSubmit(
    () =>
      createFixedIncomeAsset({
        origin: 'manual',
        kind,
        issuer_id: issuer,
        indexer,
        rate: parseRate(rate) ?? '0',
        issued_at: issuedAt,
        ...(caixinha
          ? caixinhaBody(terms)
          : {
              maturity_date: maturity,
              liquidity,
              ...(liquidity === 'd_plus_n'
                ? { liquidity_days: Number(liquidityDays) }
                : {}),
            }),
        tax_regime: tax,
        ...(name.trim() === '' ? {} : { name: name.trim() }),
      }).then((asset) => {
        created.current = asset;
      }),
    () => {
      if (created.current !== null) onCreated(created.current);
    },
  );

  const save = (): void => {
    setAttempted(true);
    if (valid) submit();
  };

  const klass = CLASS_BY_KIND[kind];
  const kindLabel = KINDS.find((item) => item.value === kind)?.label ?? '';
  const [step, setStep] = useState<1 | 2>(1);

  const next = (): void => {
    setAttempted(true);
    if (errors.issuer === undefined) {
      setAttempted(false);
      setStep(2);
    }
  };

  const stepper = (
    <span className="flex items-center gap-3 text-xs text-ink-3">
      Passo {step} de 2
      <span aria-hidden="true" className="flex gap-1">
        <span className="h-0.5 w-6 rounded-full bg-ink" />
        <span
          className={`h-0.5 w-6 rounded-full ${step === 2 ? 'bg-ink' : 'bg-line-2'}`}
        />
      </span>
    </span>
  );

  return (
    <Modal
      open
      guard
      wide={step === 2}
      narrow={step === 1}
      title={`Cadastrar ${kindLabel}`}
      aside={stepper}
      onClose={onClose}
    >
      {step === 1 ? (
        <FormShell
          pending={false}
          error={null}
          saveLabel="Próximo"
          saveShortcut={null}
          showCancel={false}
          onSave={next}
          onCancel={onClose}
        >
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Tipo</FieldLabel>
            <Segmented label="Tipo" options={KINDS} value={kind} onChange={setKind} />
          </div>

          {kind === 'cdb' ? (
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Modelo</FieldLabel>
              <div role="radiogroup" aria-label="Modelo" className="flex flex-col gap-2">
                {MODELS.map((option) => (
                  <ModelCard
                    key={option.value}
                    checked={model === option.value}
                    title={option.label}
                    description={
                      option.value === 'title'
                        ? 'Uma aplicação, com data de aplicação e vencimento próprios.'
                        : 'Um ativo só: cada aporte é um lote com a própria data, e o resgate consome os lotes pela regra definida no próximo passo.'
                    }
                    onSelect={() => setModel(option.value)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <Field
            label="Emissor"
            error={attempted ? errors.issuer : undefined}
            hint={
              institutions.length === 0
                ? 'Cadastre a instituição em Configurações › Instituições.'
                : undefined
            }
          >
            {(control) => (
              <Select
                {...control}
                invalid={attempted && errors.issuer !== undefined}
                value={issuer}
                placeholder="Escolha a instituição"
                options={institutions}
                onChange={(event) => setIssuer(event.target.value)}
              />
            )}
          </Field>
        </FormShell>
      ) : (
        <FormShell
          pending={pending}
          error={error}
          saveLabel="Cadastrar e continuar"
          showCancel={false}
          onSave={save}
          onCancel={onClose}
          secondary={
            <Button variant="ghost" onClick={() => setStep(1)}>
              Voltar
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-[13rem_1fr]">
            <dl className="flex flex-col gap-4 self-start rounded-panel bg-panel-2 p-5 text-[0.8125rem]">
              <SummaryItem term="Nome exibido">{name.trim() || suggested}</SummaryItem>
              <SummaryItem term="Classe">Renda fixa · {klass.label}</SummaryItem>
              <SummaryItem term="Emissor">{issuerName}</SummaryItem>
              <SummaryItem term="Modelo">
                {caixinha ? 'Caixinha · aportes em lotes' : 'Título único'}
              </SummaryItem>
            </dl>

            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Indexador</FieldLabel>
                <Segmented
                  label="Indexador"
                  options={INDEXERS}
                  value={indexer}
                  onChange={setIndexer}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Field label="Taxa" error={attempted ? errors.rate : undefined}>
                  {(control) => (
                    <span className="relative block">
                      <Input
                        {...control}
                        numeric
                        inputMode="decimal"
                        invalid={attempted && errors.rate !== undefined}
                        className="pr-16"
                        value={rate}
                        placeholder="112,00"
                        onChange={(event) => setRate(event.target.value)}
                      />
                      <span className="pointer-events-none absolute top-0 right-2.5 flex h-[38px] items-center text-xs text-ink-3">
                        {RATE_SUFFIX[indexer]}
                      </span>
                    </span>
                  )}
                </Field>
                <Field
                  label={caixinha ? 'Abertura' : 'Aplicação'}
                  error={attempted ? errors.issuedAt : undefined}
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="date"
                      invalid={attempted && errors.issuedAt !== undefined}
                      value={issuedAt}
                      onChange={(event) => setIssuedAt(event.target.value)}
                    />
                  )}
                </Field>
                {caixinha ? null : (
                  <Field
                    label="Vencimento"
                    error={attempted ? errors.maturity : undefined}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        type="date"
                        invalid={attempted && errors.maturity !== undefined}
                        value={maturity}
                        onChange={(event) => setMaturity(event.target.value)}
                      />
                    )}
                  </Field>
                )}
              </div>

              {caixinha ? (
                <CaixinhaFields
                  form={terms}
                  onChange={setTerms}
                  attempted={attempted}
                  issuedAt={issuedAt}
                />
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>Liquidez</FieldLabel>
                    <Segmented
                      label="Liquidez"
                      options={LIQUIDITIES}
                      value={liquidity}
                      onChange={setLiquidity}
                    />
                    {liquidity === 'd_plus_n' ? (
                      <Field
                        label="Dias de carência"
                        error={attempted ? errors.days : undefined}
                      >
                        {(control) => (
                          <Input
                            {...control}
                            numeric
                            inputMode="numeric"
                            invalid={attempted && errors.days !== undefined}
                            value={liquidityDays}
                            onChange={(event) => setLiquidityDays(event.target.value)}
                          />
                        )}
                      </Field>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>Imposto de renda</FieldLabel>
                    <Segmented
                      label="Imposto de renda"
                      options={TAXES}
                      value={tax}
                      onChange={setTax}
                    />
                  </div>
                </div>
              )}

              {caixinha ? (
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>Imposto de renda</FieldLabel>
                  <Segmented
                    label="Imposto de renda"
                    options={TAXES}
                    value={tax}
                    onChange={setTax}
                  />
                </div>
              ) : null}

              <Field label="Nome exibido" hint="gerado automaticamente; editável">
                {(control) => (
                  <Input
                    {...control}
                    invalid={false}
                    value={name}
                    placeholder={suggested}
                    onChange={(event) => setName(event.target.value)}
                  />
                )}
              </Field>
            </div>
          </div>
        </FormShell>
      )}
    </Modal>
  );
};

const SummaryItem = ({
  term,
  children,
}: {
  readonly term: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <div>
    <dt className="text-xs text-ink-3">{term}</dt>
    <dd className="font-semibold">{children}</dd>
  </div>
);

/** O cartão de escolha do Modelo: o marcado ganha a borda e o fundo de destaque. */
const ModelCard = ({
  checked,
  title,
  description,
  onSelect,
}: {
  readonly checked: boolean;
  readonly title: string;
  readonly description: string;
  readonly onSelect: () => void;
}): React.ReactElement => (
  <button
    type="button"
    role="radio"
    aria-checked={checked}
    className={`flex cursor-pointer items-start gap-3 rounded-panel border p-3.5 text-left ${
      checked ? 'border-accent bg-accent-soft' : 'border-line-2 bg-panel hover:bg-panel-2'
    }`}
    onClick={onSelect}
  >
    <span
      aria-hidden="true"
      className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
        checked ? 'border-accent' : 'border-line-2'
      }`}
    >
      {checked ? <span className="size-2 rounded-full bg-accent" /> : null}
    </span>
    <span className="min-w-0">
      <span className="block text-[0.8125rem] font-semibold">{title}</span>
      <span className="block text-xs text-ink-3">{description}</span>
    </span>
  </button>
);
