import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { fetchAccounts } from '../../api/accounts.js';
import type { AccountsResource } from '../../api/accounts.js';
import { usePreferences } from '../../components/preferences.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { PanelError } from '../../finance/components/states.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { formatMoney } from '../../lib/format.js';

/**
 * CTA-01 · Contas: onde está o dinheiro. Saldo de hoje, previsto de fim de mês e
 * a linha de total, que soma só as contas com "no patrimônio". Sem sparklines e
 * sem seção de benefícios; arquivadas ficam ocultas até "mostrar arquivadas".
 */
const asOf = (iso: string): string =>
  `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export const AccountsScreen = (): React.ReactElement => {
  const { hidden } = usePreferences();
  const navigate = useNavigate();
  const [data, setData] = useState<AccountsResource | null>(null);
  const [failed, setFailed] = useState(false);
  const [archived, setArchived] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchAccounts(archived, controller.signal)
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [archived, reload]);

  if (failed) {
    return (
      <PanelError
        title="Não foi possível carregar as contas"
        onRetry={() => {
          setFailed(false);
          setReload((n) => n + 1);
        }}
      />
    );
  }
  if (data === null) return <TableScreenSkeleton label="Carregando contas" columns={7} />;

  const money = (value: string): string => formatMoney(value, { hidden }).text;
  const counted = data.accounts.filter((r) => !r.account.archived && r.account.in_wealth);
  const countedIds = counted.map((r) => r.account.id).join(',');

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title="Contas"
        subtitle={`Em contas ${money(data.total_balance)} · saldos de ${asOf(data.as_of)}`}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />
        Mostrar arquivadas
      </label>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-label text-ink-3 uppercase">
            <th scope="col">Conta</th>
            <th scope="col" className="max-md:hidden">
              Instituição
            </th>
            <th scope="col" className="max-lg:hidden">
              Cartões
            </th>
            <th scope="col">No patrimônio</th>
            <th scope="col" className="text-right">
              Saldo hoje
            </th>
            <th scope="col" className="text-right">
              Previsto em fim de mês
            </th>
          </tr>
        </thead>
        <tbody>
          {data.accounts.map((row) => (
            <tr
              key={row.account.id}
              tabIndex={0}
              className="cursor-pointer hover:bg-panel-2"
              onClick={() => navigate(`/contas-novo/${row.account.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') navigate(`/contas-novo/${row.account.id}`);
              }}
            >
              <th scope="row" className="text-left font-normal">
                {row.account.name}
                <span className="block text-xs text-ink-3">{row.account.role}</span>
              </th>
              <td className="max-md:hidden">{row.account.institution ?? '—'}</td>
              <td className="max-lg:hidden">
                {row.cards.length === 0 ? '—' : row.cards.join(', ')}
              </td>
              <td>{row.account.in_wealth ? '● Sim' : '○ Não'}</td>
              <td className="tabular text-right">{money(row.balance)}</td>
              <td className="tabular text-right">{money(row.projected_month_end)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr
            tabIndex={0}
            className="cursor-pointer font-semibold hover:bg-panel-2"
            onClick={() => navigate(financeRoutes.entries(`conta=${countedIds}`))}
            onKeyDown={(e) => {
              if (e.key === 'Enter')
                navigate(financeRoutes.entries(`conta=${countedIds}`));
            }}
          >
            <th scope="row" colSpan={3} className="text-left">
              Total em contas
            </th>
            <td />
            <td className="tabular text-right">{money(data.total_balance)}</td>
            <td className="tabular text-right">{money(data.projected_total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
