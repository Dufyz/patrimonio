import type { AssetPageIdentity, CategoryResource } from '@patrimonio/contracts';
import { useEffect, useMemo, useState } from 'react';

import {
  archiveAsset,
  deleteAsset,
  fetchCategories,
  updateAsset,
} from '../../api/registers.js';
import { Modal } from '../../components/overlay.js';
import { Button } from '../../components/primitives.js';
import { colorForToken } from '../../lib/tokens.js';
import { Callout, Field, Input, Select } from '../entry/fields.js';
import { FormShell } from '../entry/form_shell.js';
import { DeleteDialog } from './delete_dialog.js';
import { useSubmit } from './use_submit.js';

/**
 * A prancha 14 C, E e F: editar, arquivar e excluir um ativo.
 *
 * Mudar a categoria reclassifica todo o histórico do ativo e a alocação de
 * todas as carteiras que o têm — e é por isso que o aviso aparece assim que o
 * campo muda, e não depois do salvar. Excluir um ativo com lançamentos é
 * recusado pela `api`; a saída é arquivar, que o esconde das buscas e do
 * cadastro mas guarda o histórico.
 */
export const AssetDialog = ({
  asset,
  onClose,
  onSaved,
  onDelete,
  onArchive,
}: {
  readonly asset: AssetPageIdentity;
  readonly onClose: () => void;
  readonly onSaved: (ticker: string) => void;
  readonly onDelete: () => void;
  readonly onArchive: () => void;
}): React.ReactElement => {
  const [ticker, setTicker] = useState(asset.ticker);
  const [name, setName] = useState(asset.name);
  const [sector, setSector] = useState(asset.sector ?? '');
  const [category, setCategory] = useState(asset.category_id ?? '');
  const [categories, setCategories] = useState<readonly CategoryResource[]>([]);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then(setCategories)
      .catch(() => {
        // Sem a lista o campo só mostra a categoria atual; o resto do cadastro edita.
      });
    return () => controller.abort();
  }, []);

  const options = useMemo(() => {
    const parents = new Set(categories.map((item) => item.parent_id));
    return categories
      .filter((item) => !parents.has(item.id))
      .map((item) => ({ id: item.id, name: item.name }));
  }, [categories]);

  const tickerError = ticker.trim() === '' ? 'Informe o código.' : undefined;
  const nameError = name.trim() === '' ? 'Informe o nome.' : undefined;
  const categoryChanged = category !== (asset.category_id ?? '');

  const { pending, error, submit } = useSubmit(
    () =>
      updateAsset(asset.asset_id, {
        ticker: ticker.trim().toUpperCase(),
        name: name.trim(),
        sector: sector.trim() === '' ? null : sector.trim(),
        category_id: category === '' ? null : category,
      }),
    () => onSaved(ticker.trim().toUpperCase()),
  );

  const save = (): void => {
    setAttempted(true);
    if (tickerError === undefined && nameError === undefined) submit();
  };

  return (
    <Modal
      open
      narrow
      title={`Editar ativo · ${asset.ticker}`}
      subtitle={asset.name}
      onClose={onClose}
    >
      <FormShell
        pending={pending}
        error={error}
        onSave={save}
        onCancel={onClose}
        destructive={
          <>
            <Button
              icon="archive"
              disabled={asset.archived_at !== null}
              onClick={onArchive}
            >
              Arquivar
            </Button>
            <Button variant="destructive" icon="trash" onClick={onDelete}>
              Excluir
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Código" error={attempted ? tickerError : undefined}>
            {(control) => (
              <Input
                {...control}
                data-autofocus
                invalid={attempted && tickerError !== undefined}
                value={ticker}
                onChange={(event) => setTicker(event.target.value)}
              />
            )}
          </Field>
          <Field label="Nome" error={attempted ? nameError : undefined}>
            {(control) => (
              <Input
                {...control}
                invalid={attempted && nameError !== undefined}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Categoria"
            hint={asset.category_automatic ? 'sugerida pela regra; editável' : undefined}
          >
            {(control) => (
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-xs"
                  style={{ backgroundColor: colorForToken(asset.color_token) }}
                />
                <span className="min-w-0 flex-1">
                  <Select
                    {...control}
                    invalid={false}
                    changed={categoryChanged}
                    value={category}
                    placeholder={asset.category_name ?? 'Sem categoria'}
                    options={options}
                    onChange={(event) => setCategory(event.target.value)}
                  />
                </span>
              </span>
            )}
          </Field>
          <Field label="Setor">
            {(control) => (
              <Input
                {...control}
                invalid={false}
                value={sector}
                onChange={(event) => setSector(event.target.value)}
              />
            )}
          </Field>
        </div>

        {categoryChanged ? (
          <Callout tone="warning">
            Mudar a categoria reclassifica todo o histórico do ativo e altera a alocação
            de todas as carteiras que o têm.
          </Callout>
        ) : null}

        <Field label="Fonte de preço">
          {() => (
            <p className="text-[0.8125rem] text-ink-2">
              {asset.price_source === 'manual'
                ? 'Manual — o preço vale até você defini-lo de novo.'
                : 'Automática — o preço vem da base de mercado.'}{' '}
              O preço manual é definido na página do ativo.
            </p>
          )}
        </Field>
      </FormShell>
    </Modal>
  );
};

/** Excluir ativo: sem histórico, a confirmação; com histórico, o aviso e a saída. */
export const DeleteAssetDialog = ({
  asset,
  onClose,
  onDone,
  onOpenStatement,
}: {
  readonly asset: AssetPageIdentity;
  readonly onClose: () => void;
  readonly onDone: () => void;
  readonly onOpenStatement: () => void;
}): React.ReactElement => {
  // A `api` é quem sabe se há histórico. A tela tenta, e o que a recusa diz —
  // lançamentos, posição aberta — vira o aviso, sem a tela contar por conta
  // própria o que o servidor vai decidir.
  const [refusal, setRefusal] = useState<string | null>(null);

  if (refusal !== null) {
    return (
      <DeleteDialog
        title={`${asset.ticker} não pode ser excluído`}
        subject={asset.ticker}
        blocked={`${refusal} Arquivar esconde o ativo das buscas e do cadastro, mas mantém o histórico e a rentabilidade passada.`}
        blockedAction={{ label: 'Ver lançamentos', onClick: onOpenStatement }}
        onConfirm={() => Promise.resolve()}
        onClose={onClose}
        onDone={onDone}
      />
    );
  }

  return (
    <DeleteDialog
      title={`Excluir ${asset.ticker}?`}
      subtitle="Nenhum lançamento usa este ativo"
      subject={`${asset.ticker} · ${asset.name}`}
      consequence="O cadastro é removido e o código volta a aparecer apenas na busca da base."
      confirmLabel="Excluir ativo"
      onConfirm={() =>
        deleteAsset(asset.asset_id).catch((cause: unknown) => {
          setRefusal(cause instanceof Error ? cause.message : 'A api não respondeu.');
          // Já foi tratada: o modal troca para o aviso, sem repetir o erro.
          return new Promise<never>(() => {});
        })
      }
      onClose={onClose}
      onDone={onDone}
    />
  );
};

/** Arquivar: esconde das buscas e do cadastro, guarda o histórico. Exige posição zerada. */
export const ArchiveAssetDialog = ({
  asset,
  onClose,
  onDone,
}: {
  readonly asset: AssetPageIdentity;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): React.ReactElement => {
  const { pending, error, submit } = useSubmit(
    () => archiveAsset(asset.asset_id, true),
    onDone,
  );

  return (
    <Modal
      open
      narrow
      title={`Arquivar ${asset.ticker}?`}
      subtitle={asset.name}
      onClose={onClose}
      footer={
        <>
          <span />
          <div className="flex items-center gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" data-autofocus disabled={pending} onClick={submit}>
              {pending ? 'Arquivando…' : 'Arquivar'}
            </Button>
          </div>
        </>
      }
    >
      <p className="text-[0.8125rem] text-ink-2">
        Arquivar esconde o ativo das buscas e do cadastro, mas mantém o histórico. Só é
        possível arquivar depois que a posição for zerada.
      </p>
      {error === null ? null : <Callout tone="error">{error}</Callout>}
    </Modal>
  );
};
