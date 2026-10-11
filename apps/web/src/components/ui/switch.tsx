import { Switch as SwitchPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn.js';

/** O interruptor de preferência: 36 × 20, ligado em acento. */
export const Switch = ({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>): React.ReactElement => (
  <SwitchPrimitive.Root
    data-slot="switch"
    className={cn(
      'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-2 bg-panel-2 p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-3.5 rounded-full bg-ink-3 transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-accent-ink" />
  </SwitchPrimitive.Root>
);
