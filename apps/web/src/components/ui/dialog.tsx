import { Dialog as DialogPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn.js';
import { Icon } from '../icon.js';

/**
 * O diálogo respeita a altura da janela: o cabeçalho e o rodapé ficam onde estão
 * e só o corpo rola. A página de trás nunca precisa rolar para o modal continuar
 * à vista.
 *
 * O diálogo do shadcn (Radix) com a pele da prancha 13: raio 12, borda
 * `line-2`, sombra em duas camadas, cabeçalho com título em 16/600, corpo com
 * respiro de 20 × 24 e rodapé branco, separado por uma linha (v2).
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>): React.ReactElement => (
  <DialogPrimitive.Overlay
    data-slot="dialog-overlay"
    className={cn('fixed inset-0 z-40 bg-overlay', className)}
    {...props}
  />
);

export const DialogContent = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>): React.ReactElement => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-8">
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'pointer-events-auto flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-line-2 bg-panel text-ink shadow-dialog outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </div>
  </DialogPrimitive.Portal>
);

export const DialogHeader = ({
  className,
  children,
  closeLabel = 'Fechar',
  aside,
  ...props
}: React.ComponentProps<'header'> & {
  readonly closeLabel?: string;
  /** O que fica à esquerda do X: o "Passo 1 de 2" de um assistente. */
  readonly aside?: React.ReactNode;
}): React.ReactElement => (
  <header
    data-slot="dialog-header"
    className={cn(
      'flex shrink-0 items-start justify-between gap-3 border-b border-line px-6 pt-5 pb-4',
      className,
    )}
    {...props}
  >
    <div className="flex min-w-0 items-start gap-3">{children}</div>
    {aside === undefined ? null : <div className="ml-auto shrink-0">{aside}</div>}
    <DialogPrimitive.Close
      aria-label={closeLabel}
      className="-mt-0.5 -mr-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-3 hover:bg-panel-2 hover:text-ink"
    >
      <Icon name="close" />
    </DialogPrimitive.Close>
  </header>
);

export const DialogTitle = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>): React.ReactElement => (
  <DialogPrimitive.Title
    data-slot="dialog-title"
    className={cn('truncate text-base leading-[22px] font-semibold', className)}
    {...props}
  />
);

export const DialogDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>): React.ReactElement => (
  <DialogPrimitive.Description
    data-slot="dialog-description"
    className={cn('text-xs text-ink-3', className)}
    {...props}
  />
);

export const DialogBody = ({
  className,
  ...props
}: React.ComponentProps<'div'>): React.ReactElement => (
  <div
    data-slot="dialog-body"
    className={cn(
      'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5',
      className,
    )}
    {...props}
  />
);

export const DialogFooter = ({
  className,
  ...props
}: React.ComponentProps<'footer'>): React.ReactElement => (
  <footer
    data-slot="dialog-footer"
    className={cn(
      'flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-panel px-6 py-4',
      className,
    )}
    {...props}
  />
);
