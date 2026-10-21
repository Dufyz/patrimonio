import { useState } from 'react';
import type { DateRange } from 'react-day-picker';

import { WEEKDAY_INITIALS } from '../lib/calendar.js';
import type { Period } from '../lib/period.js';
import {
  PERIOD_FULL_LABELS,
  PERIOD_SHORTCUTS,
  formatRange,
  resolvePeriod,
} from '../lib/period.js';
import { Icon } from './icon.js';
import { Button, Label } from './primitives.js';
import { Calendar } from './ui/calendar.js';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';

/**
 * D-06 · O seletor de período.
 *
 * Os cinco atalhos ficam visíveis e o sexto botão abre o calendário. Escolhido
 * um intervalo, o botão passa a mostrá-lo — `01/09 – 06/10` — em vez de voltar a
 * ser reticências, porque o estado precisa estar na tela e não só na URL.
 *
 * O calendário é o do shadcn dentro de um `Popover`: ele se posiciona sozinho
 * contra as bordas da janela — vira para o outro lado e encosta na margem em
 * vez de abrir para fora da tela —, e em janela estreita mostra um mês só.
 */

export type PeriodControlProps = {
  readonly value: Period;
  readonly onChange: (period: Period) => void;
  readonly today: string;
  readonly inception: string | null;
};

/** `2026-09-01` → o dia local à meia-noite; só para o calendário desenhar. */
const toDate = (iso: string): Date => {
  const [year = '1970', month = '1', day = '1'] = iso.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day));
};

const toIso = (date: Date): string =>
  `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`;

const brDate = (iso: string | null): string =>
  iso === null ? '—' : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export const PeriodControl = ({
  value,
  onChange,
  today,
  inception,
}: PeriodControlProps): React.ReactElement => {
  const [open, setOpen] = useState(false);

  const range = formatRange(resolvePeriod(value, today, inception), today);
  const name =
    value.kind === 'preset' ? PERIOD_FULL_LABELS[value.preset] : 'Personalizado';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Período: ${name}`}
          className="inline-flex h-control cursor-pointer items-center gap-2 rounded-control border border-line-2 bg-panel px-[11px] text-[0.78125rem] font-medium text-ink hover:bg-panel-2"
        >
          <Icon name="calendar" />
          <span>{name}</span>
          <span className="tabular text-[0.71875rem] font-normal text-ink-3">
            {range}
          </span>
          <Icon name="chevron-down" />
        </button>
      </PopoverTrigger>
      <RangePopover
        value={value}
        today={today}
        inception={inception}
        onChange={onChange}
        onClose={() => setOpen(false)}
      />
    </Popover>
  );
};

/**
 * O período como um botão só — o da prancha 07: ícone de calendário, o
 * intervalo e a seta. Abre o mesmo calendário.
 */
export const PeriodRangeButton = ({
  value,
  onChange,
  today,
  inception,
}: PeriodControlProps): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const label = formatRange(resolvePeriod(value, today, inception), today);

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
      <RangePopover
        value={value}
        today={today}
        inception={inception}
        onChange={onChange}
        onClose={() => setOpen(false)}
      />
    </Popover>
  );
};

const RangePopover = ({
  value,
  today,
  inception,
  onChange,
  onClose,
}: PeriodControlProps & { readonly onClose: () => void }): React.ReactElement => {
  return (
    <PopoverContent
      role="dialog"
      aria-label="Período personalizado"
      collisionPadding={16}
      className="flex max-w-[calc(100vw-2rem)] flex-wrap"
    >
      <RangeBody
        value={value}
        today={today}
        inception={inception}
        onChange={onChange}
        onClose={onClose}
      />
    </PopoverContent>
  );
};

/** O conteúdo do calendário, para quem o hospeda num popover próprio. */
export const PeriodRangeBody = (
  props: PeriodControlProps & { readonly onClose: () => void },
): React.ReactElement => (
  <div className="flex max-w-[calc(100vw-2rem)] flex-wrap">
    <RangeBody {...props} />
  </div>
);

const RangeBody = ({
  value,
  today,
  onChange,
  onClose,
}: PeriodControlProps & { readonly onClose: () => void }): React.ReactElement => {
  const initial = value.kind === 'custom' ? { from: value.from, to: value.to } : null;
  const [range, setRange] = useState<DateRange | undefined>(
    initial === null ? undefined : { from: toDate(initial.from), to: toDate(initial.to) },
  );

  const todayDate = toDate(today);
  const narrow = globalThis.innerWidth < 760;
  const complete = range?.from !== undefined && range.to !== undefined;
  const from = range?.from === undefined ? null : toIso(range.from);
  const to = range?.to === undefined ? null : toIso(range.to);
  const anchor = range?.to ?? todayDate;

  return (
    <>
      <div className="w-44 border-r border-line py-2 max-sm:w-full max-sm:border-r-0 max-sm:border-b">
        {PERIOD_SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut.preset}
            type="button"
            aria-current={
              value.kind === 'preset' && value.preset === shortcut.preset
                ? 'true'
                : undefined
            }
            className={`mx-2 block w-[calc(100%-1rem)] cursor-pointer rounded-control px-2 py-2 text-left text-[0.84375rem] ${
              value.kind === 'preset' && value.preset === shortcut.preset
                ? 'bg-accent-soft font-semibold'
                : 'hover:bg-panel-2'
            }`}
            onClick={() => {
              onChange({ kind: 'preset', preset: shortcut.preset });
              onClose();
            }}
          >
            {shortcut.label}
          </button>
        ))}
        <span
          className={`mx-2 mt-1 block rounded-control px-2 py-2 text-left text-[0.84375rem] ${
            value.kind === 'custom' ? 'bg-accent-soft font-semibold' : 'text-ink-2'
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
          selected={range}
          onSelect={setRange}
          disabled={{ after: todayDate }}
          endMonth={todayDate}
          formatters={{
            formatWeekdayName: (day) => WEEKDAY_INITIALS[day.getDay()] ?? '',
          }}
        />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex gap-3">
            <span className="flex flex-col gap-1">
              <Label>De</Label>
              <output className="tabular flex h-[38px] min-w-32 items-center rounded-control border border-line-2 px-2.5 text-sm">
                {brDate(from)}
              </output>
            </span>
            <span className="flex flex-col gap-1">
              <Label>Até</Label>
              <output className="tabular flex h-[38px] min-w-32 items-center rounded-control border border-line-2 px-2.5 text-sm">
                {brDate(to)}
              </output>
            </span>
          </div>

          <div className="flex gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={!complete}
              onClick={() => {
                if (from !== null && to !== null) {
                  onChange({ kind: 'custom', from, to });
                  onClose();
                }
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
