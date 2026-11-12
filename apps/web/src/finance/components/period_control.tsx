import { useState } from 'react';

import { Icon } from '../../components/icon.js';
import { RangePickerBody } from '../../components/period_control.js';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js';
import type { IsoDate } from '../lib/dates.js';
import { PERIOD_SHORTCUTS, formatRange, shortcutFor } from '../lib/period.js';
import type { DateRange } from '../lib/period.js';

/**
 * FIN-003 · O controle de período único.
 *
 * É o seletor de intervalo de Investimentos — o mesmo botão (calendário,
 * intervalo, seta) e o mesmo corpo (atalhos + calendário de dois meses) —, com
 * os atalhos de Finanças e datas futuras liberadas, porque o mês inclui os
 * lançamentos previstos. Nenhuma tela tem outro controle de período.
 */
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
  const active = shortcutFor(value, today);

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
          shortcuts={PERIOD_SHORTCUTS.map((shortcut) => ({
            id: shortcut.id,
            label: shortcut.label,
            range: shortcut.range(today),
          }))}
          activeId={active}
          custom={active === null ? value : null}
          today={today}
          allowFuture
          onShortcut={(shortcut) => onChange(shortcut.range as DateRange)}
          onApply={(range) => onChange(range as DateRange)}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
};
