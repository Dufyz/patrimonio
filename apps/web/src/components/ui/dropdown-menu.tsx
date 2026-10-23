import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn.js';

/**
 * O menu de contexto do shadcn (Radix) com a pele da prancha 16: painel de
 * raio 8, borda `line-2`, itens de 13 px em peso 400 e a ação destrutiva por
 * último, separada por uma linha.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = ({
  className,
  sideOffset = 4,
  align = 'end',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>): React.ReactElement => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      data-slot="dropdown-menu-content"
      sideOffset={sideOffset}
      align={align}
      className={cn(
        'z-50 flex min-w-[220px] flex-col rounded-panel border border-line-2 bg-panel p-1 text-ink shadow-menu outline-none',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
);

export const DropdownMenuItem = ({
  className,
  destructive = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  readonly destructive?: boolean;
}): React.ReactElement => (
  <DropdownMenuPrimitive.Item
    data-slot="dropdown-menu-item"
    className={cn(
      'flex cursor-pointer items-center justify-between gap-4 rounded-[5px] px-2.5 py-2 text-left text-[0.8125rem] font-normal outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-panel-2',
      destructive && 'text-negative data-[highlighted]:bg-negative-soft',
      className,
    )}
    {...props}
  />
);

export const DropdownMenuSeparator = ({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>): React.ReactElement => (
  <DropdownMenuPrimitive.Separator
    data-slot="dropdown-menu-separator"
    className={cn('my-1 border-t border-line', className)}
    {...props}
  />
);
