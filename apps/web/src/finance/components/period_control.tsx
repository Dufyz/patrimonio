import { useState } from 'react';
import type { DateRange as PickerRange } from 'react-day-picker';

import { Icon } from '../../components/icon.js';
import { Button, Label } from '../../components/primitives.js';
import { Calendar } from '../../components/ui/calendar.js';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js';
import { WEEKDAY_INITIALS } from '../../lib/calendar.js';
import { parseIso, toIso } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { PERIOD_SHORTCUTS, formatDate, formatRange, shortcutFor } from '../lib/period.js';
import type { DateRange } from '../lib/period.js';

/**
 * FIN-003 · O controle de período único.
 *
 * Um botão com ícone de calendário e o intervalo ("01/10 – 31/10") que abre um
 * seletor de intervalo livre, com atalhos de mês atual, mês anterior e últimos
 * 12 meses. Nenhuma tela tem outro controle de período.
 */

const toLocalDate = (iso: IsoDate): Date => {
  const { year, month, day } = parseIso(iso);
  return new Date(year, month - 1, day);
};

const fromLocalDate = (date: Date): IsoDate =>
  toIso(date.getFullYear(), date.getMonth() + 1, date.getDate());

export const PeriodControl = ({
  value,
  onChange,
  today,
}: {
  readonly value: DateRange;
  readonly onChange: (range: DateRange) => void;
  readonly today: IsoDate;
}): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const label = formatRange(value, today);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Período: ${label}`}
          className="inline-flex h-control cursor-pointer items-center gap-2 rounded-control border border-line-2 bg-panel px-[11px] text-[0.78125rem] font-medium text-ink-2 hover:bg-panel-2"
        >
          <Icon name="calendar" />
          <span className="tabular">{label}</span>
          <Icon name="chevron-down" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label="Escolher período"
        align="end"
        collisionPadding={16}
        className="flex max-w-[calc(100vw-2rem)] flex-wrap"
      >
        <PeriodBody
          value={value}
          today={today}
          onApply={(range) => {
            onChange(range);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
};

const PeriodBody = ({
  value,
  today,
  onApply,
  onCancel,
}: {
  readonly value: DateRange;
  readonly today: IsoDate;
  readonly onApply: (range: DateRange) => void;
  readonly onCancel: () => void;
}): React.ReactElement => {
  const [picked, setPicked] = useState<PickerRange | undefined>({
    from: toLocalDate(value.from),
    to: toLocalDate(value.to),
  });
  const active = shortcutFor(value, today);
  const narrow = globalThis.innerWidth < 760;

  const from = picked?.from === undefined ? null : fromLocalDate(picked.from);
  const to = picked?.to === undefined ? null : fromLocalDate(picked.to);
  const anchor = picked?.to ?? toLocalDate(value.to);

  return (
    <>
      <div className="w-48 border-r border-line py-2 max-sm:w-full max-sm:border-r-0 max-sm:border-b">
        {PERIOD_SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut.id}
            type="button"
            aria-current={active === shortcut.id ? 'true' : undefined}
            className={`mx-2 block w-[calc(100%-1rem)] rounded-control px-2 py-2 text-left text-[0.84375rem] ${
              active === shortcut.id ? 'bg-accent-soft font-semibold' : 'hover:bg-panel-2'
            }`}
            onClick={() => onApply(shortcut.range(today))}
          >
            {shortcut.label}
          </button>
        ))}
        <span
          className={`mx-2 mt-1 block rounded-control px-2 py-2 text-[0.84375rem] ${
            active === null ? 'bg-accent-soft font-semibold' : 'text-ink-2'
          }`}
        >
          Personalizado
        </span>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <Calendar
          mode="range"
          numberOfMonths={narrow ? 1 : 2}
          defaultMonth={
            narrow ? anchor : new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)
          }
          selected={picked}
          onSelect={setPicked}
          formatters={{
            formatWeekdayName: (day) => WEEKDAY_INITIALS[day.getDay()] ?? '',
          }}
        />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex gap-3">
            <span className="flex flex-col gap-1">
              <Label>De</Label>
              <output className="tabular flex h-[38px] min-w-28 items-center rounded-control border border-line-2 px-2.5 text-sm">
                {from === null ? '—' : formatDate(from, today)}
              </output>
            </span>
            <span className="flex flex-col gap-1">
              <Label>Até</Label>
              <output className="tabular flex h-[38px] min-w-28 items-center rounded-control border border-line-2 px-2.5 text-sm">
                {to === null ? '—' : formatDate(to, today)}
              </output>
            </span>
          </div>
          <div className="flex gap-2">
            <Button onClick={onCancel}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={from === null || to === null}
              onClick={() => {
                if (from !== null && to !== null) onApply({ from, to });
              }}
            >
              Aplicar
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};
