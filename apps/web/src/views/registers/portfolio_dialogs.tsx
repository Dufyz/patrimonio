import type { SettingsPortfolio } from '@patrimonio/contracts';
import { useState } from 'react';

import {
  createPortfolio,
  deletePortfolio,
  updatePortfolio,
} from '../../api/registers.js';
import { Icon } from '../../components/icon.js';
import { Modal } from '../../components/overlay.js';
import { Button } from '../../components/primitives.js';
import { Checkbox } from '../../components/ui/checkbox.js';
import { Callout, Field, Input } from '../entry/fields.js';
import { FormShell } from '../entry/form_shell.js';
import { plural } from '../../lib/settings.js';
import { DeleteDialog } from './delete_dialog.js';
import { useSubmit } from './use_submit.js';

/**
 * A prancha 15 A: criar e editar carteira.
 *
 * A carteira guarda só o nome. O benchmark não é atributo dela: é uma escolha de
 * quem olha, feita em cada gráfico entre os índices fixos; a alocação alvo mora
 * na Estratégia, e os objetivos — quantos forem — medem a carteira de fora. O
 * mesmo formulário cria e edita — criar é editar uma carteira vazia, como o
 * subtítulo da prancha diz.
 */
export const PortfolioDialog = ({
  portfolio,
  onClose,
  onSaved,
  onDelete,
}: {
  /** `null` cria. */
  readonly portfolio: SettingsPortfolio | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly onDelete?: (() => void) | undefined;
}): React.ReactElement => {
  const [name, setName] = useState(portfolio?.name ?? '');
  const [attempted, setAttempted] = useState(false);

  const trimmed = name.trim();
  const nameError = trimmed === '' ? 'Dê um nome à carteira.' : undefined;

  const { pending, error, submit } = useSubmit(() => {
    const body = { name: trimmed };
    return portfolio === null
      ? createPortfolio(body)
      : updatePortfolio(portfolio.id, body);
  }, onSaved);

  const save = (): void => {
    setAttempted(true);
    if (nameError === undefined) submit();
  };

  return (
    <Modal
      open
      guard
      narrow
      title={portfolio === null ? 'Nova carteira' : 'Editar carteira'}
      subtitle={
        portfolio === null
          ? 'Uma carteira separa o dinheiro por propósito'
          : 'Criar usa o mesmo formulário, vazio'
      }
      onClose={onClose}
    >
      <FormShell
        pending={pending}
        error={error}
        onSave={save}
        onCancel={onClose}
        destructive={
          portfolio === null || onDelete === undefined ? undefined : (
            <Button variant="destructive" icon="trash" onClick={onDelete}>
              Excluir carteira
            </Button>
          )
        }
      >
        <Field label="Nome" error={attempted ? nameError : undefined}>
          {(control) => (
            <Input
              {...control}
              data-autofocus
              invalid={attempted && nameError !== undefined}
              value={name}
              placeholder="Longo prazo"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
      </FormShell>
    </Modal>
  );
};

/**
 * Excluir a carteira (prancha 15 D). Uma carteira pode ser excluída com o
 * conteúdo que tiver, e excluir significa excluir tudo: lançamentos, posições,
 * estratégia, objetivos e o histórico de patrimônio dela. Como não há volta, o
 * botão só destrava depois de dois checks — marcar que entendeu o que some e
 * digitar o nome da carteira.
 */
export const DeletePortfolioDialog = ({
  portfolio,
  onClose,
  onDone,
}: {
  readonly portfolio: SettingsPortfolio;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): React.ReactElement => {
  const { transactions, assets } = portfolio.blocking;
  const goals = portfolio.goals.length;

  const [understood, setUnderstood] = useState(false);
  const [typed, setTyped] = useState('');

  const confirmed = typed.trim() === portfolio.name;

  const gone = [
    plural(transactions, 'lançamento', 'lançamentos'),
    plural(assets, 'ativo', 'ativos'),
    ...(goals === 0 ? [] : [plural(goals, 'objetivo', 'objetivos')]),
    ...(portfolio.strategy_categories === 0 ? [] : ['a estratégia de alocação']),
    'todo o histórico de patrimônio e rentabilidade',
  ];

  return (
    <DeleteDialog
      title={`Excluir ${portfolio.name}?`}
      subtitle="Esta ação não pode ser desfeita"
      subject={`a carteira ${portfolio.name}, com tudo que há nela`}
      confirmLabel="Excluir carteira e tudo nela"
      canConfirm={understood && confirmed}
      onClose={onClose}
      onDone={onDone}
      onConfirm={() => {
        if (!understood || !confirmed) {
          return Promise.reject(
            new Error('Confirme as duas etapas para excluir a carteira.'),
          );
        }
        return deletePortfolio(portfolio.id, {
          confirm_name: portfolio.name,
          transactions: 'delete',
        });
      }}
    >
      <Callout tone="warning">
        <strong className="font-semibold">Atenção: tudo será apagado junto.</strong> Serão
        excluídos permanentemente: {gone.join(', ')}. O patrimônio de todas as datas
        passadas deixa de incluir esta carteira.
      </Callout>

      <label className="flex cursor-pointer items-start gap-2.5 text-[0.8125rem]">
        <Checkbox
          className="mt-0.5"
          checked={understood}
          onCheckedChange={(next) => setUnderstood(next === true)}
        />
        <span>
          Entendo que a exclusão é permanente e apaga tudo que a carteira contém.
        </span>
      </label>

      <Field label={`Digite ${portfolio.name} para confirmar`}>
        {(control) => (
          <Input
            {...control}
            invalid={false}
            value={typed}
            placeholder={portfolio.name}
            onChange={(event) => setTyped(event.target.value)}
          />
        )}
      </Field>
      {!confirmed && typed !== '' ? (
        <p className="-mt-2 flex items-center gap-1.5 text-xs text-ink-3">
          <Icon name="info" size={14} />O nome precisa ser igual ao da carteira.
        </p>
      ) : null}
    </DeleteDialog>
  );
};
