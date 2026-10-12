import type { AssetResource, InstitutionResource } from '@patrimonio/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchInstitutions } from '../../api/institutions.js';
import { createFixedIncomeAsset } from '../../api/registers.js';
import type { FixedIncomeBody } from '../../api/registers.js';
import { Modal } from '../../components/overlay.js';
import { Chip, Label, Segmented } from '../../components/primitives.js';
import { Field, Input, Select } from '../entry/fields.js';
import { FormShell } from '../entry/form_shell.js';
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

  const issuerName = institutions.find((item) => item.id === issuer)?.name ?? '';
  const suggested = useMemo(() => {
    const label = KINDS.find((item) => item.value === kind)?.label ?? '';
    const rateText = parseRate(rate);
    const spec = INDEXERS.find((item) => item.value === indexer)?.label ?? '';
    return [
      `${label} ${issuerName}`.trim(),
      monthYear(maturity),
      rateText === null ? null : `${rateText.replace('.', ',')} ${spec}`,
    ]
      .filter((part) => part !== null && part !== '')
      .join(' · ')
      .replace(' · ', ' ');
  }, [kind, issuerName, maturity, rate, indexer]);

  const errors = {
    issuer: issuer === '' ? 'Escolha o emissor.' : undefined,
    rate: parseRate(rate) === null ? 'Informe a taxa, como 112,00.' : undefined,
    issuedAt: issuedAt === '' ? 'Informe a data da aplicação.' : undefined,
    maturity:
      maturity === ''
        ? 'Informe o vencimento.'
        : issuedAt !== '' && maturity <= issuedAt
          ? 'O vencimento vem depois da aplicação.'
          : undefined,
    days:
      liquidity === 'd_plus_n' && !/^[1-9]\d*$/.test(liquidityDays.trim())
        ? 'Informe os dias.'
        : undefined,
  };
  const valid = Object.values(errors).every((error) => error === undefined);

  const { pending, error, submit } = useSubmit(
    () =>
      createFixedIncomeAsset({
        origin: 'manual',
        kind,
        issuer_id: issuer,
        indexer,
        rate: parseRate(rate) ?? '0',
        issued_at: issuedAt,
        maturity_date: maturity,
        liquidity,
        ...(liquidity === 'd_plus_n' ? { liquidity_days: Number(liquidityDays) } : {}),
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

  return (
    <Modal
      open
      guard
      title="Cadastrar título"
      subtitle="Títulos bancários e crédito privado não têm cotação pública; o preço é marcado na curva pela taxa"
      onClose={onClose}
    >
      <FormShell
        pending={pending}
        error={error}
        saveLabel="Cadastrar"
        onSave={save}
        onCancel={onClose}
      >
        <div className="flex flex-col gap-1.5">
          <Label>Tipo</Label>
          <Segmented label="Tipo" options={KINDS} value={kind} onChange={setKind} />
        </div>

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

        <div className="flex flex-col gap-1.5">
          <Label>Indexador</Label>
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
          <Field label="Aplicação" error={attempted ? errors.issuedAt : undefined}>
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
          <Field label="Vencimento" error={attempted ? errors.maturity : undefined}>
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
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Liquidez</Label>
            <Segmented
              label="Liquidez"
              options={LIQUIDITIES}
              value={liquidity}
              onChange={setLiquidity}
            />
            {liquidity === 'd_plus_n' ? (
              <Field label="Dias de carência" error={attempted ? errors.days : undefined}>
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
            <Label>Imposto de renda</Label>
            <Segmented
              label="Imposto de renda"
              options={TAXES}
              value={tax}
              onChange={setTax}
            />
          </div>
        </div>

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

        <div className="flex items-center gap-2 text-xs text-ink-2">
          Classe definida pelo indexador:
          <Chip colorToken={klass.token}>{klass.label}</Chip>
        </div>
      </FormShell>
    </Modal>
  );
};
