import { Checkbox as CheckboxPrimitive } from 'radix-ui';

import { cn } from '../../lib/cn.js';
import { Icon } from '../icon.js';

/** A caixa de seleção: 16 px, borda de 1,5 e, marcada, o fundo de acento. */
export const Checkbox = ({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>): React.ReactElement => (
  <CheckboxPrimitive.Root
    data-slot="checkbox"
    className={cn(
      'inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded border-[1.5px] border-line-2 bg-panel align-middle text-accent-ink outline-none focus-visible:ring-2 focus-visible:ring-focus/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-line-2 data-[state=indeterminate]:text-ink-2',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator>
      {props.checked === 'indeterminate' ? (
        <span className="block h-0.5 w-2 rounded-full bg-current" />
      ) : (
        <Icon name="check" size={12} />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
);
