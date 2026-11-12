import { useState } from 'react';
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
  /** O intervalo livre em vigor: o calendário abre nele. */
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

  const todayDate = toDate(today);
  const narrow = globalThis.innerWidth < 760;
  const complete = range?.from !== undefined && range.to !== undefined;
  const from = range?.from === undefined ? null : toIso(range.from);
  const to = range?.to === undefined ? null : toIso(range.to);
  const anchor = range?.to ?? todayDate;

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
        <span
          className={`mx-2 mt-1 block rounded-control px-2 py-2 text-left text-[0.84375rem] ${
            activeId === null ? 'bg-accent-soft font-semibold' : 'text-ink-2'
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
          {...(allowFuture
            ? {}
            : { disabled: { after: todayDate }, endMonth: todayDate })}
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
    custom={value.kind === 'custom' ? { from: value.from, to: value.to } : null}
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
        <RangePickerBody
          shortcuts={FLOW_SHORTCUTS.map((shortcut) => ({
            id: shortcut.id,
            label: shortcut.label,
            range: shortcut.range(today),
          }))}
          activeId={active}
          custom={active === null ? value : null}
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
