import { Button } from '../../components/primitives.js';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import type { InstallmentScope } from '../domain/installment_ops.js';

/** FIN-510 · "Todas as parcelas ou só as futuras?" ao editar ou excluir uma compra parcelada. */
export const InstallmentScopeDialog = ({
  action,
  description,
  onChoose,
  onClose,
}: {
  readonly action: 'editar' | 'excluir';
  readonly description: string;
  readonly onChoose: (scope: InstallmentScope) => void;
  readonly onClose: () => void;
}): React.ReactElement => (
  <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          {action === 'editar' ? 'Editar compra parcelada' : 'Excluir compra parcelada'}
        </DialogTitle>
      </DialogHeader>
      <DialogBody>
        <DialogDescription className="text-[0.8125rem] text-ink-2">
          {description} é uma compra parcelada. A mudança vale para todas as parcelas ou
          só para esta e as futuras?
        </DialogDescription>
      </DialogBody>
      <DialogFooter className="justify-end">
        <Button onClick={onClose}>Cancelar</Button>
        <Button onClick={() => onChoose('futuras')}>Só as futuras</Button>
        <Button
          variant={action === 'excluir' ? 'danger' : 'primary'}
          onClick={() => onChoose('todas')}
        >
          Todas as parcelas
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
