import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn.js';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = ({
  className,
  sideOffset = 4,
  align = 'start',
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>): React.ReactElement => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      data-slot="popover-content"
      sideOffset={sideOffset}
      align={align}
      className={cn(
        'z-50 rounded-panel border border-line-2 bg-panel text-ink shadow-menu outline-none',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
);
