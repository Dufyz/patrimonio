import { useRef, useState } from 'react';
import type { DateRange } from 'react-day-picker';

import { WEEKDAY_INITIALS } from '../lib/calendar.js';
import type { Period, PeriodPreset } from '../lib/period.js';
import {
  PERIOD_FULL_LABELS,
  PERIOD_SHORTCUTS,
  formatRange,
  resolvePeriod,
} from '../lib/period.js';
import type { IsoDate } from '../finance/lib/dates.js';
import {
  PERIOD_SHORTCUTS as FLOW_SHORTCUTS,
  formatRange as formatFlowRange,
  shortcutFor as flowShortcutFor,
} from '../finance/lib/period.js';
import type { DateRange as FlowRange } from '../finance/lib/period.js';
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

/** `17072026` → `17/07/2026`, enquanto a pessoa digita. */
const maskBrDate = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

/** `17/07/2026` → a data, ou `null` se não for um dia que existe. */
const parseBrDate = (text: string): Date | null => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (match === null) return null;
  const [, d = '', m = '', y = ''] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.getDate() === Number(d) && date.getMonth() === Number(m) - 1 ? date : null;
};

const DateTextField = ({
  label,
  value,
  invalid = false,
  inputRef,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly invalid?: boolean;
  readonly inputRef?: React.Ref<HTMLInputElement>;
  readonly onChange: (raw: string) => void;
}): React.ReactElement => {
  const broken = value.length === 10 && parseBrDate(value) === null;
  return (
    <label className="flex flex-col gap-1">
      <Label>{label}</Label>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        aria-invalid={invalid || broken ? true : undefined}
        className={`tabular h-[38px] w-36 rounded-control border bg-panel px-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-focus/30 ${
          invalid || broken ? 'border-negative' : 'border-line-2'
        }`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
};

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

export type RangeShortcut = {
  readonly id: string;
  readonly label: string;
  readonly range: { readonly from: string; readonly to: string };
};

/**
 * O corpo do seletor de intervalo, sem saber de presets: atalhos à esquerda e
 * calendário de dois meses à direita. Investimentos o alimenta com os presets de
 * período; Finanças, com mês atual, mês anterior e 12 meses — e libera datas
 * futuras (`allowFuture`), porque lá existem lançamentos previstos.
 */
export const RangePickerBody = ({
  shortcuts,
  activeId,
  custom,
  today,
  allowFuture = false,
  onShortcut,
  onApply,
  onClose,
}: {
  readonly shortcuts: readonly RangeShortcut[];
  readonly activeId: string | null;
  /** O intervalo em vigor (atalho ou livre): o calendário abre com ele marcado. */
  readonly custom: { readonly from: string; readonly to: string } | null;
  readonly today: string;
  readonly allowFuture?: boolean;
  readonly onShortcut: (shortcut: RangeShortcut) => void;
  readonly onApply: (range: { from: string; to: string }) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [range, setRange] = useState<DateRange | undefined>(
    custom === null ? undefined : { from: toDate(custom.from), to: toDate(custom.to) },
  );
  // "Personalizado" é um atalho como os outros: marcado, o foco vai para o "De".
  const [customMode, setCustomMode] = useState(activeId === null);
  const [fromText, setFromText] = useState(custom === null ? '' : brDate(custom.from));
  const [toText, setToText] = useState(custom === null ? '' : brDate(custom.to));
  const fromInput = useRef<HTMLInputElement>(null);

  const todayDate = toDate(today);
  const narrow = globalThis.innerWidth < 760;
  const complete = range?.from !== undefined && range.to !== undefined;
  const from = range?.from === undefined ? null : toIso(range.from);
  const to = range?.to === undefined ? null : toIso(range.to);
  const [month, setMonth] = useState<Date>(() => {
    const anchor = range?.to ?? todayDate;
    return narrow ? anchor : new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
  });
  const outOfBounds = (date: Date): boolean => !allowFuture && date > todayDate;

  const pick = (next: DateRange | undefined): void => {
    setRange(next);
    setCustomMode(true);
    setFromText(next?.from === undefined ? '' : brDate(toIso(next.from)));
    setToText(next?.to === undefined ? '' : brDate(toIso(next.to)));
  };

  /** Digitado: aceita dd/mm/aaaa; datas válidas movem o calendário até elas. */
  const type = (which: 'from' | 'to', raw: string): void => {
    const text = maskBrDate(raw);
    (which === 'from' ? setFromText : setToText)(text);
    setCustomMode(true);
    const date = parseBrDate(text);
    if (date === null || outOfBounds(date)) {
      if (text.length === 10 || text === '') {
        setRange((current) =>
          which === 'from'
            ? current?.to === undefined
              ? undefined
              : { from: undefined, to: current.to }
            : current?.from === undefined
              ? undefined
              : { from: current.from, to: undefined },
        );
      }
      return;
    }
    setRange((current) => {
      const other = which === 'from' ? current?.to : current?.from;
      if (other === undefined) {
        return which === 'from'
          ? { from: date, to: undefined }
          : { from: undefined, to: date };
      }
      return which === 'from' ? { from: date, to: other } : { from: other, to: date };
    });
    setMonth(
      narrow || which === 'from'
        ? new Date(date.getFullYear(), date.getMonth(), 1)
        : new Date(date.getFullYear(), date.getMonth() - 1, 1),
    );
  };
  const ordered = from !== null && to !== null && from <= to;

  return (
    <>
      <div className="w-44 border-r border-line py-2 max-sm:w-full max-sm:border-r-0 max-sm:border-b">
        {shortcuts.map((shortcut) => (
          <button
            key={shortcut.id}
            type="button"
            aria-current={activeId === shortcut.id ? 'true' : undefined}
            className={`mx-2 block w-[calc(100%-1rem)] cursor-pointer rounded-control px-2 py-2 text-left text-[0.84375rem] ${
              activeId === shortcut.id
                ? 'bg-accent-soft font-semibold'
                : 'hover:bg-panel-2'
            }`}
            onClick={() => {
              onShortcut(shortcut);
              onClose();
            }}
          >
            {shortcut.label}
          </button>
        ))}
        <button
          type="button"
          aria-current={customMode ? 'true' : undefined}
          className={`mx-2 block w-[calc(100%-1rem)] cursor-pointer rounded-control px-2 py-2 text-left text-[0.84375rem] ${
            customMode ? 'bg-accent-soft font-semibold' : 'hover:bg-panel-2'
          }`}
          onClick={() => {
            setCustomMode(true);
            fromInput.current?.focus();
            fromInput.current?.select();
          }}
        >
          Personalizado
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <Calendar
          mode="range"
          numberOfMonths={narrow ? 1 : 2}
          month={month}
          onMonthChange={setMonth}
          selected={range}
          onSelect={pick}
          {...(allowFuture
            ? {}
            : { disabled: { after: todayDate }, endMonth: todayDate })}
          formatters={{
            formatWeekdayName: (day) => WEEKDAY_INITIALS[day.getDay()] ?? '',
          }}
        />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex gap-3">
            <DateTextField
              label="De"
              inputRef={fromInput}
              value={fromText}
              onChange={(raw) => type('from', raw)}
            />
            <DateTextField
              label="Até"
              value={toText}
              invalid={from !== null && to !== null && !ordered}
              onChange={(raw) => type('to', raw)}
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={!complete || !ordered}
              onClick={() => {
                if (from !== null && to !== null) {
                  onApply({ from, to });
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

const RangeBody = ({
  value,
  today,
  inception,
  onChange,
  onClose,
}: PeriodControlProps & { readonly onClose: () => void }): React.ReactElement => (
  <RangePickerBody
    shortcuts={PERIOD_SHORTCUTS.map((shortcut) => ({
      id: shortcut.preset,
      label: shortcut.label,
      range: resolvePeriod({ kind: 'preset', preset: shortcut.preset }, today, inception),
    }))}
    activeId={value.kind === 'preset' ? value.preset : null}
    custom={resolvePeriod(value, today, inception)}
    today={today}
    onShortcut={(shortcut) =>
      onChange({ kind: 'preset', preset: shortcut.id as PeriodPreset })
    }
    onApply={(range) => onChange({ kind: 'custom', from: range.from, to: range.to })}
    onClose={onClose}
  />
);

/**
 * CMP-05 · O controle de período do fluxo (intervalo livre em datas).
 *
 * É o seletor de intervalo de Investimentos — o mesmo botão (calendário,
 * intervalo, seta) e o mesmo corpo (atalhos + calendário de dois meses) —, com
 * os atalhos de Finanças e datas futuras liberadas, porque o mês inclui os
 * lançamentos previstos. Nenhuma tela tem outro controle de período.
 */
export const FlowPeriodControl = ({
  value,
  onChange,
  today,
}: {
  readonly value: FlowRange;
  readonly onChange: (range: FlowRange) => void;
  readonly today: IsoDate;
}): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const label = formatFlowRange(value, today);
  const active = flowShortcutFor(value, today);
  const name =
    FLOW_SHORTCUTS.find((shortcut) => shortcut.id === active)?.label ?? 'Personalizado';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Período: ${name} · ${label}`}
          className="inline-flex h-control cursor-pointer items-center gap-2 rounded-control border border-line-2 bg-panel px-[11px] text-[0.78125rem] font-medium text-ink hover:bg-panel-2"
        >
          <Icon name="calendar" />
          <span>{name}</span>
          <span className="tabular text-[0.71875rem] font-normal text-ink-3">
            {label}
          </span>
          <Icon name="chevron-down" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label="Período personalizado"
        collisionPadding={16}
        className="flex max-w-[calc(100vw-2rem)] flex-wrap"
      >
        <RangePickerBody
          shortcuts={FLOW_SHORTCUTS.map((shortcut) => ({
            id: shortcut.id,
            label: shortcut.label,
            range: shortcut.range(today),
          }))}
          activeId={active}
          custom={value}
          today={today}
          allowFuture
          onShortcut={(shortcut) => onChange(shortcut.range as FlowRange)}
          onApply={(range) => onChange(range as FlowRange)}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
};
