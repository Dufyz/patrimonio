import { useState } from 'react';

import { WEEKDAY_INITIALS } from '../lib/calendar.js';
import { Icon } from './icon.js';
import { Button, Label } from './primitives.js';
import { Calendar } from './ui/calendar.js';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';

/**
 * O seletor de data único da aplicação: um campo com ícone de calendário que
 * abre o mesmo `Calendar` do seletor de período. Todo `type="date"` de
 * formulário passa por aqui (via `Input`), então não existe campo de data com
 * o calendário nativo do navegador.
 */

const toDate = (iso: string): Date | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const [year = '1970', month = '1', day = '1'] = iso.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day));
};

const toIso = (date: Date): string =>
  `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`;

export const formatBrDate = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
    : '';

export type DatePickerProps = {
  readonly value: string;
  readonly onChange: (iso: string) => void;
  readonly min?: string | undefined;
  readonly max?: string | undefined;
  readonly id?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly invalid?: boolean | undefined;
  readonly changed?: boolean | undefined;
  readonly placeholder?: string | undefined;
  /**
   * Com rótulo, o calendário oferece "Sem data" (o previsto de data incerta):
   * escolhê-lo devolve `''`, e o campo mostra esse rótulo.
   */
  readonly emptyLabel?: string | undefined;
  readonly className?: string | undefined;
  readonly 'aria-describedby'?: string | undefined;
  readonly 'aria-invalid'?: boolean | undefined;
  readonly 'aria-label'?: string | undefined;
};

export const DatePicker = ({
  value,
  onChange,
  min,
  max,
  id,
  disabled,
  invalid = false,
  changed = false,
  placeholder = 'dd/mm/aaaa',
  emptyLabel,
  className,
  ...aria
}: DatePickerProps): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const selected = toDate(value);
  const minDate = min === undefined ? undefined : toDate(min);
  const maxDate = max === undefined ? undefined : toDate(max);
  const border = invalid
    ? 'border-negative bg-negative-soft'
    : changed
      ? 'border-attention bg-attention-soft'
      : 'border-line-2 bg-field';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-describedby={aria['aria-describedby']}
          aria-invalid={aria['aria-invalid']}
          aria-label={aria['aria-label']}
          className={`tabular flex h-[38px] w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-control border px-2.5 text-left text-sm font-normal outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-ink-3 ${border} ${className ?? ''}`}
        >
          <span className={selected === undefined ? 'text-ink-3' : 'text-ink'}>
            {selected === undefined ? (emptyLabel ?? placeholder) : formatBrDate(value)}
          </span>
          <span aria-hidden="true" className="text-ink-2">
            <Icon name="calendar" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label="Escolher data"
        collisionPadding={16}
        className="w-auto p-4"
      >
        {/* A mesma pele do seletor de período: iniciais da semana, dia escolhido
            cheio em azul e o rodapé com a data e as ações. */}
        <div className="flex flex-col gap-4">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? maxDate ?? new Date()}
            onSelect={(date) => {
              if (date === undefined) return;
              onChange(toIso(date));
              setOpen(false);
            }}
            formatters={{
              formatWeekdayName: (day) => WEEKDAY_INITIALS[day.getDay()] ?? '',
            }}
            classNames={{
              selected:
                '[&>button]:bg-accent [&>button]:font-medium [&>button]:text-accent-ink [&>button]:hover:bg-accent-hover',
            }}
            disabled={[
              ...(minDate === undefined ? [] : [{ before: minDate }]),
              ...(maxDate === undefined ? [] : [{ after: maxDate }]),
            ]}
          />
          <div className="flex items-end justify-between gap-3 border-t border-line pt-3">
            <span className="flex flex-col gap-1">
              <Label>Data</Label>
              <output className="tabular flex h-[38px] min-w-32 items-center rounded-control border border-line-2 px-2.5 text-sm">
                {selected === undefined ? (emptyLabel ?? '—') : formatBrDate(value)}
              </output>
            </span>
            <span className="flex gap-2">
              {emptyLabel === undefined ? null : (
                <Button
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                >
                  {emptyLabel}
                </Button>
              )}
              <Button
                onClick={() => {
                  onChange(toIso(new Date()));
                  setOpen(false);
                }}
              >
                Hoje
              </Button>
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
