import { useEffect, useState } from 'react';

import type { BookResponse, BookRowResource } from '@patrimonio/contracts';

import { confirmPlanned, fetchBook } from '../../api/book.js';
import { StatStrip } from '../../finance/components/stat_strip.js';
import { formatMoney, MINUS } from '../../lib/format.js';
import {
  dayLabel,
  overdueNote,
  plannedSection,
  sectionsByDay,
  signOf,
} from '../../lib/ledger_book.js';
import { usePreferences } from '../../components/preferences.js';

/**
 * LAN-01 · Lançamentos: a faixa de cinco células e a tabela do período, por dia.
 *
 * Tudo vem do livro da `api`; a tela só rotula e agrupa. A soma da coluna Valor
 * das linhas lançadas fecha com a faixa (teste em `lib/ledger_book.test.ts`).
 */
const KIND_LABEL: Readonly<Record<BookRowResource['kind'], string>> = {
  RECEITA: 'Receita',
  DESPESA: 'Despesa',
  TRANSFERENCIA: 'Transferência',
  PAGAMENTO_FATURA: 'Pagamento de fatura',
  APORTE: 'Aporte',
  RESGATE: 'Resgate',
  PROVENTO: 'Provento',
  EVENTO: 'Evento',
};

const currentMonth = (): string => new Date().toISOString().slice(0, 7);

export const LedgerScreen = (): React.ReactElement => {
  const { hidden } = usePreferences();
  const [month] = useState(currentMonth);
  const [book, setBook] = useState<BookResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const controller = new AbortController();
    fetchBook({ month, limit: 200 }, controller.signal)
      .then(setBook)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [month, reload]);

  if (failed) return <p role="alert">Não foi possível carregar os lançamentos.</p>;
  if (book === null) return <p role="status">Carregando…</p>;

  const money = (value: string, sign: '+' | '-' | ''): string => {
    const text = formatMoney(value, { hidden }).text;
    return sign === '-' ? `${MINUS}${text}` : sign === '+' ? `+${text}` : text;
  };
  const { totals } = book;
  const planned = plannedSection(book.rows, today);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-screen-title font-semibold">Lançamentos</h1>
      <StatStrip
        label="Resumo do período"
        cells={[
          { id: 'receitas', label: 'Receitas', value: money(totals.receitas, '+') },
          { id: 'despesas', label: 'Despesas', value: money(totals.despesas, '-') },
          { id: 'aportes', label: 'Aportes', value: money(totals.aportes, '-') },
          {
            id: 'saldo',
            label: 'Saldo do mês',
            value: formatMoney(totals.saldo_do_mes, { hidden, signed: true }).text,
          },
          {
            id: 'a-lancar',
            label: 'A lançar',
            value: String(totals.a_lancar),
            caption: `${totals.a_lancar} previstos até ${book.range.to.slice(8)}/${book.range.to.slice(5, 7)}`,
          },
        ]}
      />
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-label text-ink-3 uppercase">
            <th scope="col">Data</th>
            <th scope="col">Descrição</th>
            <th scope="col">Tipo</th>
            <th scope="col" className="text-right">
              Valor
            </th>
            <td />
          </tr>
        </thead>
        {planned.rows.length === 0 ? null : (
          <tbody data-section="previstos">
            <tr>
              <th scope="rowgroup" colSpan={5} className="pt-3 text-left text-ink-2">
                Próximos dias · previstos{' '}
                <span className="font-normal text-ink-3">
                  {planned.counter} · não entram nos totais do mês
                </span>
              </th>
            </tr>
            {planned.rows.map((row) => {
              const note = overdueNote(row.date, today);
              return (
                <tr key={row.id} data-situation="previsto" className="bg-planned-soft">
                  <td className="tabular">
                    {row.date.slice(8)}/{row.date.slice(5, 7)}
                    {note === null ? null : (
                      <span className="ml-2 text-attention">{note}</span>
                    )}
                  </td>
                  <td>{row.description}</td>
                  <td>{KIND_LABEL[row.kind]}</td>
                  <td className="tabular text-right">
                    {row.amount === null ? '—' : money(row.amount, signOf(row.kind))}
                  </td>
                  <td data-launch>
                    {row.entry === null ? null : (
                      <button
                        type="button"
                        onClick={() => {
                          void confirmPlanned(row.id).then(() => setReload((n) => n + 1));
                        }}
                      >
                        Lançar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        )}
        {sectionsByDay(book.rows.filter((r) => r.situation === 'lancado')).map(
          (section) => (
            <tbody key={section.date}>
              <tr>
                <th scope="rowgroup" colSpan={5} className="pt-3 text-left text-ink-2">
                  {dayLabel(section.date)}
                </th>
              </tr>
              {section.rows.map((row) => (
                <tr key={row.id} data-situation={row.situation}>
                  <td className="tabular">
                    {row.date.slice(8)}/{row.date.slice(5, 7)}
                  </td>
                  <td>{row.description}</td>
                  <td>{KIND_LABEL[row.kind]}</td>
                  <td className="tabular text-right">
                    {row.amount === null ? '—' : money(row.amount, signOf(row.kind))}
                  </td>
                </tr>
              ))}
            </tbody>
          ),
        )}
      </table>
    </div>
  );
};
