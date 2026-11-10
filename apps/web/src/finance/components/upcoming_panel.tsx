import { useMemo } from 'react';

import { Panel } from '../../components/primitives.js';
import { projectBalance, upcomingEvents } from '../domain/projection.js';
import type { CashEventType } from '../domain/projection.js';
import type { FinanceData } from '../domain/types.js';
import { categoryColor } from '../lib/category_colors.js';
import { addDays } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { formatDay } from '../lib/format.js';
import { Amount } from './amount.js';
import { CategoryMarker, FinTable, Row, Td, Th, THead } from './fin_table.js';
import { EmptyPanel } from './states.js';

/**
 * Próximos 30 dias: o que ainda vai mexer nas contas, em ordem. É o que a
 * projeção de saldo soma; faturas saem no vencimento.
 */

const WINDOW_DAYS = 30;

const KIND_LABEL: Readonly<Record<CashEventType, string>> = {
  receita: 'Receita',
  despesa: 'Despesa',
  fatura: 'Fatura',
};

export const UpcomingPanel = ({
  data,
  today,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
}): React.ReactElement => {
  const events = useMemo(
    () =>
      upcomingEvents(
        projectBalance(data, today, addDays(today, WINDOW_DAYS)),
        WINDOW_DAYS,
      ),
    [data, today],
  );
  const accountName = (id: string): string =>
    data.accounts.find((account) => account.id === id)?.name ?? '—';

  return (
    <Panel
      title="Próximos 30 dias"
      action={<span className="text-xs text-ink-3">o que ainda vai sair e entrar</span>}
    >
      {events.length === 0 ? (
        <EmptyPanel message="Nada previsto para os próximos 30 dias." />
      ) : (
        <FinTable caption="Próximos 30 dias">
          <THead>
            <Th>Data</Th>
            <Th>Descrição</Th>
            <Th>Tipo</Th>
            <Th>Conta</Th>
            <Th align="right">Valor</Th>
          </THead>
          <tbody>
            {events.map((event) => {
              const category = data.categories.find((c) => c.id === event.categoryId);
              return (
                <Row key={event.id}>
                  <Td numeric className="!text-left">
                    {formatDay(event.date, today)}
                  </Td>
                  <Td className="font-medium">
                    {category === undefined ? (
                      event.label
                    ) : (
                      <CategoryMarker
                        color={categoryColor(category.color)}
                        name={event.label}
                      />
                    )}
                  </Td>
                  <Td className="text-ink-2">{KIND_LABEL[event.type]}</Td>
                  <Td className="text-ink-2">{accountName(event.accountId)}</Td>
                  <Td numeric>
                    <Amount cents={event.cents} variant="flow" />
                  </Td>
                </Row>
              );
            })}
          </tbody>
        </FinTable>
      )}
    </Panel>
  );
};
