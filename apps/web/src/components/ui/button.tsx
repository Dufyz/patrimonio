import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '../../lib/cn.js';

/**
 * O botão do shadcn, com a pele da prancha 03: 34 px de altura, Plex Sans 12,5
 * em peso 500 (600 nas ações cheias), borda de controle `line-2`.
 *
 * `destructive` é o texto vermelho sem fundo — a ação destrutiva do rodapé do
 * modal, longe do botão que a mão já sabe. `danger` é o botão cheio vermelho,
 * reservado para a confirmação final de uma exclusão.
 */
export const buttonVariants = cva(
  'inline-flex h-control shrink-0 cursor-pointer items-center justify-center gap-2 rounded-control border px-[11px] font-sans text-[0.78125rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus/40 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'border-btn bg-btn font-semibold text-btn-ink hover:border-btn-hover hover:bg-btn-hover',
        secondary: 'border-line-2 bg-panel text-ink-2 hover:bg-panel-2 hover:text-ink',
        ghost: 'border-transparent bg-transparent text-ink-2 hover:bg-panel-2',
        destructive:
          'border-transparent bg-transparent text-negative hover:bg-negative-soft',
        danger: 'border-negative bg-negative font-semibold text-white hover:opacity-90',
      },
      size: {
        default: '',
        icon: 'size-control px-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

export const UiButton = ({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  ButtonVariants & { readonly asChild?: boolean }): React.ReactElement => {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
};
