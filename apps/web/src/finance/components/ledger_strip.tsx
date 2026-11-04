import { StatStrip } from './stat_strip.js';
import { Amount } from './amount.js';
import type { Indicators } from '../domain/ledger.js';
import { pluralize } from '../lib/header.js';
import { formatDate } from '../lib/period.js';
import type { DateRange } from '../lib/period.js';

/**
 * FIN-301 · A faixa de indicadores de Lançamentos: Receitas, Despesas, Saldo do
 * período e Ainda a lançar. Igual nos quatro agrupamentos da tela.
 */
export const LedgerStrip = ({
  indicators,
  range,
  today,
}: {
  readonly indicators: Indicators;
  readonly range: DateRange;
  readonly today: string;
}): React.ReactElement => (
  <StatStrip
    label="Indicadores do período"
    cells={[
      {
        id: 'receitas',
        label: 'Receitas',
        value: <Amount cents={indicators.receitas.cents} className="text-positive" />,
        caption: pluralize(indicators.receitas.count, 'lançamento', 'lançamentos'),
      },
      {
        id: 'despesas',
        label: 'Despesas',
        value: <Amount cents={indicators.despesas.cents} />,
        caption: pluralize(indicators.despesas.count, 'lançamento', 'lançamentos'),
      },
      {
        id: 'saldo',
        label: 'Saldo do período',
        value: <Amount cents={indicators.saldo} variant="signed" />,
        caption: 'receitas – despesas lançadas',
      },
      {
        id: 'a-lancar',
        label: 'Ainda a lançar',
        value: <Amount cents={indicators.aLancar.cents} />,
        caption: `${pluralize(indicators.aLancar.count, 'previsto', 'previstos')} até ${formatDate(range.to, today)}`,
      },
    ]}
  />
);
