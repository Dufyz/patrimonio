import { DayPicker } from 'react-day-picker';
import { ptBR } from 'react-day-picker/locale';

import { cn } from '../../lib/cn.js';
import { Icon } from '../icon.js';

/**
 * O calendário do shadcn (react-day-picker) com a pele da prancha 16 A: título
 * do mês em 14/600, iniciais da semana em cinza, dias de 38 px, o intervalo em
 * `accent-soft` e as pontas cheias em `accent`.
 */
export const Calendar = ({
  className,
  classNames,
  ...props
}: React.ComponentProps<typeof DayPicker>): React.ReactElement => (
  <DayPicker
    locale={ptBR}
    showOutsideDays={false}
    className={cn('p-0', className)}
    classNames={{
      root: 'relative w-fit text-ink',
      months: 'flex flex-wrap gap-x-8 gap-y-4',
      month: 'flex flex-col gap-2',
      month_caption: 'flex h-8 items-center justify-center',
      caption_label: 'text-sm font-semibold capitalize',
      nav: 'absolute inset-x-0 top-0 flex h-8 items-center justify-between',
      button_previous:
        'inline-flex size-8 cursor-pointer items-center justify-center rounded-control text-ink-2 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40',
      button_next:
        'inline-flex size-8 cursor-pointer items-center justify-center rounded-control text-ink-2 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40',
      chevron: 'size-4',
      month_grid: 'border-collapse',
      weekdays: 'flex',
      weekday: 'w-[38px] py-1 text-center text-xs font-normal text-ink-3',
      week: 'mt-0.5 flex',
      day: 'size-[38px] p-0 text-center text-[0.8125rem]',
      day_button:
        'tabular inline-flex size-full cursor-pointer items-center justify-center rounded-[5px] font-normal outline-none hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-focus/40',
      selected: 'bg-accent-soft',
      range_start:
        '[&>button]:bg-accent [&>button]:font-medium [&>button]:text-accent-ink [&>button]:hover:bg-accent-hover',
      range_end:
        '[&>button]:bg-accent [&>button]:font-medium [&>button]:text-accent-ink [&>button]:hover:bg-accent-hover',
      range_middle:
        'bg-accent-soft [&>button]:text-accent [&>button]:hover:bg-accent-soft',
      today: 'font-semibold',
      outside: 'text-ink-3 opacity-50',
      disabled: 'cursor-not-allowed text-ink-3 opacity-40 [&>button]:cursor-not-allowed',
      hidden: 'invisible',
      ...classNames,
    }}
    components={{
      Chevron: ({ orientation }) => (
        <Icon name={orientation === 'left' ? 'chevron-left' : 'chevron-right'} />
      ),
    }}
    {...props}
  />
);
