import { useRef, useState } from 'react';

import type { RangeSelection } from '../lib/calendar.js';
import {
  WEEKDAY_INITIALS,
  isWithin,
  monthGrid,
  monthOf,
  previousMonth,
  selectDay,
} from '../lib/calendar.js';
import type { Period } from '../lib/period.js';
import {
  PERIOD_BUTTONS,
  PERIOD_LABELS,
  PERIOD_SHORTCUTS,
  formatRange,
  resolvePeriod,
} from '../lib/period.js';
import { Button, IconButton, Label, Segmented } from './primitives.js';
import { useDismiss } from './use_dismiss.js';

/**
 * D-06 · O seletor de período.
 *
 * Os cinco atalhos ficam visíveis e o sexto botão abre o calendário de dois
 * meses. Escolhido um intervalo, o botão passa a mostrá-lo — `01/09 – 06/10` —
 * em vez de voltar a ser reticências, porque o estado precisa estar na tela e
 * não só na URL.
 */

export type PeriodControlProps = {
  readonly value: Period;
  readonly onChange: (period: Period) => void;
  readonly today: string;
  readonly inception: string | null;
};

export const PeriodControl = ({
  value,
  onChange,
  today,
  inception,
}: PeriodControlProps): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useDismiss(container, open, () => {
    setOpen(false);
    trigger.current?.focus();
  });

  const custom = value.kind === 'custom';
  const customLabel = custom
    ? formatRange(resolvePeriod(value, today, inception), today)
    : '…';

  return (
    <div ref={container} className="relative inline-flex">
      <Segmented
        label="Período"
        options={PERIOD_BUTTONS.map((preset) => ({
          value: preset,
          label: PERIOD_LABELS[preset],
        }))}
        value={value.kind === 'preset' ? value.preset : null}
        onChange={(preset) => onChange({ kind: 'preset', preset })}
        extra={
          <button
            ref={trigger}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            className={`tabular cursor-pointer px-3 text-[0.8125rem] whitespace-nowrap ${
              custom
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-ink-2 hover:bg-panel-2'
            }`}
            onClick={() => setOpen((current) => !current)}
          >
            {customLabel}
          </button>
        }
      />

      {open ? (
        <RangeCalendar
          today={today}
          initial={
            value.kind === 'custom'
              ? { from: value.from, to: value.to }
              : { from: null, to: null }
          }
          onPreset={(preset) => {
            onChange({ kind: 'preset', preset });
            setOpen(false);
            trigger.current?.focus();
          }}
          onApply={(range) => {
            onChange({ kind: 'custom', from: range.from, to: range.to });
            setOpen(false);
            trigger.current?.focus();
          }}
          onCancel={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
};

type RangeCalendarProps = {
  readonly today: string;
  readonly initial: RangeSelection;
  readonly onPreset: (preset: (typeof PERIOD_SHORTCUTS)[number]['preset']) => void;
  readonly onApply: (range: { readonly from: string; readonly to: string }) => void;
  readonly onCancel: () => void;
};

const RangeCalendar = ({
  today,
  initial,
  onPreset,
  onApply,
  onCancel,
}: RangeCalendarProps): React.ReactElement => {
  const [selection, setSelection] = useState<RangeSelection>(initial);
  const [hovered, setHovered] = useState<string | null>(null);
  /**
   * O mês à direita. É estado, e não derivado da seleção: se os dois meses
   * seguissem o dia escolhido, clicar no começo do intervalo faria o calendário
   * pular para debaixo do cursor e o fim do intervalo sumir da tela.
   */
  const [anchor, setAnchor] = useState(() =>
    monthOf(initial.to ?? initial.from ?? today),
  );

  const left = previousMonth(anchor.year, anchor.month);
  const months = [monthGrid(left.year, left.month), monthGrid(anchor.year, anchor.month)];

  const shiftAnchor = (delta: number): void =>
    setAnchor((current) => {
      const total = current.year * 12 + (current.month - 1) + delta;
      return { year: Math.floor(total / 12), month: (total % 12) + 1 };
    });

  const complete = selection.from !== null && selection.to !== null;

  return (
    <div
      role="dialog"
      aria-label="Período personalizado"
      className="absolute top-[calc(var(--spacing-control)+0.375rem)] left-0 z-20 flex rounded-panel border border-line bg-panel shadow-lg"
    >
      <div className="w-44 border-r border-line py-2">
        {PERIOD_SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut.preset}
            type="button"
            className="block w-full cursor-pointer px-4 py-2 text-left text-sm hover:bg-panel-2"
            onClick={() => onPreset(shortcut.preset)}
          >
            {shortcut.label}
          </button>
        ))}
        <span className="mt-1 block bg-accent-soft px-4 py-2 text-left text-sm font-medium text-accent">
          Personalizado
        </span>
      </div>

      <div className="p-4">
        <div className="mb-1 flex items-center justify-between">
          <IconButton label="Mês anterior" onClick={() => shiftAnchor(-1)}>
            ‹
          </IconButton>
          <IconButton
            label="Próximo mês"
            disabled={
              `${anchor.year}-${String(anchor.month).padStart(2, '0')}` >=
              today.slice(0, 7)
            }
            onClick={() => shiftAnchor(1)}
          >
            ›
          </IconButton>
        </div>
        <div className="flex gap-6">
          {months.map((month) => (
            <table key={month.label} className="tabular text-[0.8125rem]">
              <caption className="pb-2 text-center text-sm font-semibold">
                {month.label}
              </caption>
              <thead>
                <tr>
                  {WEEKDAY_INITIALS.map((initialLetter, index) => (
                    <th
                      key={`${initialLetter}-${index}`}
                      scope="col"
                      className="size-8 font-normal text-ink-3"
                    >
                      {initialLetter}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {month.weeks.map((week, weekIndex) => (
                  <tr key={weekIndex}>
                    {week.map((day, dayIndex) => (
                      <td key={day ?? `vazio-${dayIndex}`} className="p-0">
                        {day === null ? (
                          <span className="block size-8" />
                        ) : (
                          <button
                            type="button"
                            disabled={day > today}
                            aria-pressed={isWithin(day, selection, hovered)}
                            className={`size-8 cursor-pointer disabled:cursor-not-allowed disabled:text-ink-3/50 ${
                              day === selection.from || day === selection.to
                                ? 'rounded-xs bg-accent text-accent-ink'
                                : isWithin(day, selection, hovered)
                                  ? 'bg-accent-soft text-accent'
                                  : 'hover:bg-panel-2'
                            }`}
                            onMouseEnter={() => setHovered(day)}
                            onFocus={() => setHovered(day)}
                            onClick={() =>
                              setSelection((current) => selectDay(current, day))
                            }
                          >
                            {Number(day.slice(8))}
                          </button>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="flex gap-3">
            <span className="flex flex-col gap-1">
              <Label>De</Label>
              <output className="tabular h-control rounded-control border border-line px-3 leading-[2rem]">
                {selection.from ?? '—'}
              </output>
            </span>
            <span className="flex flex-col gap-1">
              <Label>Até</Label>
              <output className="tabular h-control rounded-control border border-line px-3 leading-[2rem]">
                {selection.to ?? '—'}
              </output>
            </span>
          </div>

          <div className="flex gap-2">
            <Button onClick={onCancel}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={!complete}
              onClick={() => {
                if (selection.from !== null && selection.to !== null) {
                  onApply({ from: selection.from, to: selection.to });
                }
              }}
            >
              Aplicar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
