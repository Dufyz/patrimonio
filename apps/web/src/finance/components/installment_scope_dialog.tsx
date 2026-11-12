import { useState } from 'react';

import { Modal } from '../../components/overlay.js';
import { Button, Segmented } from '../../components/primitives.js';
import { Callout } from '../../views/entry/fields.js';
import type { EffectRow } from '../domain/effects.js';
import type { InstallmentScope } from '../domain/installment_ops.js';
import { EffectTable } from './effect_table.js';

/**
 * FIN-510 · Excluir ou editar uma compra parcelada: "só esta parcela, esta e as
 * futuras, ou a compra inteira". Excluir mostra o efeito nas faturas antes de
 * confirmar (prancha Modais E).
 */

const OPTIONS = [
  { value: 'esta', label: 'Só esta parcela' },
  { value: 'futuras', label: 'Esta e as futuras' },
  { value: 'todas', label: 'A compra inteira' },
] as const;

export const InstallmentScopeDialog = ({
  action,
  description,
  detail,
  effect,
  onChoose,
  onClose,
}: {
  readonly action: 'editar' | 'excluir';
  readonly description: string;
  /** "6x de R$ 1.299,00 no Nubank Mastercard", sob o título. */
  readonly detail?: string | undefined;
  /** O efeito de cada escopo nos números; ausente, o bloco não aparece. */
  readonly effect?: ((scope: InstallmentScope) => readonly EffectRow[]) | undefined;
  readonly onChoose: (scope: InstallmentScope) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [scope, setScope] = useState<InstallmentScope>('todas');
  const danger = action === 'excluir';
  return (
    <Modal
      open
      narrow
      {...(danger ? { tone: 'danger' as const } : {})}
      title={danger ? 'Excluir esta compra?' : 'Editar compra parcelada'}
      subtitle={detail === undefined ? description : `${description} · ${detail}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => onChoose(scope)}>
            {danger ? 'Excluir compra' : 'Continuar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[0.8125rem] text-ink-2">
          {danger ? 'O que excluir' : 'A mudança vale para'}
        </p>
        <Segmented
          label={danger ? 'O que excluir' : 'Escopo da mudança'}
          options={OPTIONS}
          value={scope}
          onChange={setScope}
        />
        {effect === undefined ? null : <EffectTable rows={effect(scope)} />}
        {danger ? (
          <Callout tone="error">
            Excluir não pode ser desfeito. Se a compra foi devolvida, prefira lançar um
            estorno para manter o histórico.
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
};
