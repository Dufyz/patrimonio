import { Tooltip as TooltipPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn.js';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

/** A dica: painel de borda `line-2`, texto de 12 px, abre no foco e no mouse. */
export const TooltipContent = ({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>): React.ReactElement => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      data-slot="tooltip-content"
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-64 rounded-control border border-line-2 bg-panel p-2 text-xs text-ink-2 shadow-menu',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
);
