import { useState } from 'react';

import { fetchInstitutions } from '../api/institutions.js';
import { transferCustody } from '../api/custody.js';
import { Modal } from '../components/overlay.js';
import { Button } from '../components/primitives.js';
import { SkeletonLines, SkeletonRegion } from '../components/skeleton.js';
import { todayDateOnly } from '../lib/entry.js';
import { useResource } from '../lib/use_resource.js';
import { Field, Input } from './entry/fields.js';
import { InstitutionPicker } from './entry/institution_picker.js';

/**
 * Transferir o ativo de uma instituição para outra.
 *
 * Não é compra nem venda: quantidade, preço médio, caixa e resultado ficam como
 * estão, e por isso o diálogo não tem preço, quantidade nem pré-visualização de
 * efeito — o que ele registra é só onde o papel passa a estar, e quando.
 *
 * A origem não é um campo. É a custódia atual, que a `api` lê do livro; o
 * diálogo a mostra, e escolher outra seria gravar uma transferência de onde o
 * papel não está.
 */
export type CustodyTransferTarget = {
  readonly portfolio_id: string;
  readonly asset_id: string;
  readonly ticker: string;
  readonly name: string;
  readonly institution_id: string | null;
  readonly institution_name: string | null;
};

export const CustodyTransferDialog = ({
  target,
  onClose,
  onSaved,
}: {
  readonly target: CustodyTransferTarget | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): React.ReactElement | null => {
  const institutions = useResource(
    (signal) => (target === null ? Promise.resolve([]) : fetchInstitutions(signal)),
    [target !== null],
  );

  const [destination, setDestination] = useState<string | null>(null);
  const [date, setDate] = useState(() => todayDateOnly());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  if (target === null) return null;

  const options = (institutions.state.kind === 'ready' ? institutions.state.value : [])
    .filter((institution) => institution.id !== target.institution_id)
    .map(({ id, name }) => ({ id, name }));

  const destinationError =
    destination === null ? 'Escolha a instituição de destino.' : undefined;
  const dateError = date.trim() === '' ? 'Informe a data da transferência.' : undefined;

  const submit = (): void => {
    setAttempted(true);
    if (destination === null || dateError !== undefined) return;

    setSaving(true);
    setError(null);

    transferCustody(target.portfolio_id, target.asset_id, {
      to_institution_id: destination,
      transfer_date: date,
      note: note.trim() === '' ? null : note.trim(),
    })
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
      title="Transferir custódia"
      subtitle={`${target.ticker} · ${target.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={saving || institutions.state.kind !== 'ready'}
            onClick={submit}
          >
            {saving ? 'Transferindo…' : 'Transferir'}
          </Button>
        </>
      }
    >
      {institutions.state.kind === 'loading' ? (
        <SkeletonRegion label="Carregando as instituições" className="py-2">
          <SkeletonLines lines={4} />
        </SkeletonRegion>
      ) : institutions.state.kind === 'error' ? (
        <div role="alert" className="flex flex-col gap-3">
          <p className="text-sm text-negative">{institutions.state.error.message}</p>
          <div>
            <Button onClick={institutions.reload}>Tentar de novo</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="text-[0.8125rem]">
            <dt className="text-xs font-medium text-ink-2">Custódia atual</dt>
            <dd>{target.institution_name ?? 'Sem instituição'}</dd>
          </dl>

          <Field
            label="Nova instituição"
            error={attempted ? destinationError : undefined}
          >
            {(control) => (
              <InstitutionPicker
                control={control}
                invalid={control['aria-invalid']}
                options={options}
                value={destination}
                onChange={setDestination}
              />
            )}
          </Field>

          <Field label="Data da transferência" error={attempted ? dateError : undefined}>
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

          <Field label="Observação (opcional)">
            {(control) => (
              <Input
                {...control}
                invalid={false}
                maxLength={280}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>

          <p className="text-[0.8125rem] text-ink-3">
            A transferência não vende nem compra: a quantidade, o preço médio e o
            resultado não mudam. O histórico de onde cada compra foi feita continua como
            está.
          </p>

          {error === null ? null : (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
};
