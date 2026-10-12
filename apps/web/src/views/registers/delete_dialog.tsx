import { useState } from 'react';

import { Callout } from '../entry/fields.js';
import { FinalDeleteAlert, Modal } from '../../components/overlay.js';
import { Button } from '../../components/primitives.js';
import { useSubmit } from './use_submit.js';

/**
 * A confirmação de exclusão dos cadastros (prancha 14 E e F, prancha 15 D).
 *
 * Nomeia o que sai e diz o que acontece com o que está ligado a ele. Quando o
 * cadastro tem uso — lançamentos, posições —, a `api` recusa, e a recusa chega
 * aqui como aviso dentro do modal, com a razão dela: excluir um ativo com
 * histórico apagaria a rentabilidade passada, e o bloqueio existe por isso.
 *
 * `blocked` é o caso em que a tela já sabe, antes do clique, que não vai dar: o
 * botão de excluir some e quem fica é o aviso, com a saída que a prancha oferece.
 */
export const DeleteDialog = ({
  title,
  subtitle,
  subject,
  consequence,
  confirmLabel = 'Excluir',
  canConfirm = true,
  blocked,
  blockedAction,
  children,
  onConfirm,
  onClose,
  onDone,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly subject: string;
  readonly consequence?: string | undefined;
  readonly confirmLabel?: string;
  /** Falso trava o botão — a confirmação por nome ainda não bate. */
  readonly canConfirm?: boolean;
  /** O que impede a exclusão, em uma frase. Preenchido, o botão destrutivo não aparece. */
  readonly blocked?: string | null | undefined;
  /** A saída oferecida quando bloqueado: "Ver lançamentos". */
  readonly blockedAction?: { readonly label: string; readonly onClick: () => void };
  /** Conteúdo extra entre a frase e o rodapé — a confirmação por nome, por exemplo. */
  readonly children?: React.ReactNode;
  readonly onConfirm: () => Promise<unknown>;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): React.ReactElement => {
  const { pending, error, submit } = useSubmit(onConfirm, onDone);
  const isBlocked = blocked !== null && blocked !== undefined;
  const [final, setFinal] = useState(false);

  return (
    <Modal
      open
      narrow
      tone={isBlocked ? undefined : 'danger'}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <span />
          <div className="flex items-center gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            {isBlocked ? (
              blockedAction === undefined ? null : (
                <Button variant="primary" data-autofocus onClick={blockedAction.onClick}>
                  {blockedAction.label}
                </Button>
              )
            ) : (
              <Button
                variant="danger"
                disabled={pending || !canConfirm}
                data-autofocus={children === undefined ? true : undefined}
                onClick={() => setFinal(true)}
              >
                {pending ? 'Excluindo…' : confirmLabel}
              </Button>
            )}
          </div>
        </>
      }
    >
      {isBlocked ? (
        <Callout tone="warning">{blocked}</Callout>
      ) : (
        <>
          <p className="text-sm">
            Será excluído: <strong className="font-semibold">{subject}</strong>
          </p>
          {consequence === undefined ? null : (
            <p className="text-[0.8125rem] text-ink-2">{consequence}</p>
          )}
          {children}
          <FinalDeleteAlert
            open={final}
            subject={subject}
            pending={pending}
            onCancel={() => setFinal(false)}
            onConfirm={() => {
              setFinal(false);
              submit();
            }}
          />
          {error === null ? null : <Callout tone="error">{error}</Callout>}
        </>
      )}
    </Modal>
  );
};
