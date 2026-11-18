import type { Settings, SettingsPortfolio } from '@patrimonio/contracts';
import { useState } from 'react';

import { usePreferences } from '../../components/preferences.js';
import { Icon } from '../../components/icon.js';
import { Button } from '../../components/primitives.js';
import { archivePortfolio, reorderPortfolios } from '../../api/registers.js';
import { formatMoney } from '../../lib/format.js';
import {
  DeletePortfolioDialog,
  PortfolioDialog,
} from '../registers/portfolio_dialogs.js';
import { notifyPortfoliosChanged } from '../../lib/portfolio_events.js';
import { plural } from '../../lib/settings.js';
import {
  Muted,
  PanelFootnote,
  ROW,
  SettingsPanel,
  SettingsSection,
  TD,
  TH,
  TH_RIGHT,
} from './parts.js';

/**
 * As seções de cadastro: carteiras. Nenhuma faz conta — contagem, soma e percentual chegam da `api`
 * —; criar, editar e excluir são modais (`views/registers`), e cada um relê as
 * configurações ao terminar.
 * O que cada linha mostra é o que o servidor usa para bloquear a exclusão, para
 * o bloqueio chegar explicado e não como um erro depois do clique.
 */

type Editing<T> =
  | { readonly kind: 'none' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly item: T }
  | { readonly kind: 'delete'; readonly item: T };

const NONE = { kind: 'none' } as const;

export const PortfoliosSection = ({
  settings,
  onChanged,
}: {
  readonly settings: Settings;
  readonly onChanged: () => void;
}): React.ReactElement => {
  const [editing, setEditing] = useState<Editing<SettingsPortfolio>>(NONE);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const { hidden } = usePreferences();
  const apply = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      notifyPortfoliosChanged();
      onChanged();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  };
  const move = (index: number, by: number): Promise<void> => {
    const ids = settings.portfolios.map((portfolio) => portfolio.id);
    const target = index + by;
    const [moved] = ids.splice(index, 1);
    if (moved === undefined || target < 0 || target > ids.length)
      return Promise.resolve();
    ids.splice(target, 0, moved);
    return apply(() => reorderPortfolios(ids));
  };
  const done = (): void => {
    setEditing(NONE);
    notifyPortfoliosChanged();
    onChanged();
  };

  return (
    <>
      <SettingsSection
        id="carteiras"
        title="Carteiras"
        description="Uma carteira separa o dinheiro por propósito. Cada uma tem estratégia e objetivo próprios, e cada posição pertence a uma carteira só."
      >
        <SettingsPanel
          title="Carteiras"
          hint="uma carteira separa o dinheiro por propósito"
          action={
            <Button icon="plus" onClick={() => setEditing({ kind: 'create' })}>
              Nova carteira
            </Button>
          }
        >
          {settings.portfolios.length === 0 ? (
            <p className="p-4 text-[0.8125rem] text-ink-3">
              Nenhuma carteira ainda. Crie a primeira para começar a lançar.
            </p>
          ) : (
            <table className="w-full text-[0.8125rem] whitespace-nowrap">
              <caption className="sr-only">Carteiras abertas</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-8">
                    <span className="sr-only">Ordem</span>
                  </th>
                  <th scope="col" className={`${TH} pl-1`}>
                    Carteira
                  </th>
                  <th scope="col" className={TH_RIGHT}>
                    Valor
                  </th>
                  <th scope="col" className={`${TH_RIGHT} max-md:hidden`}>
                    Ativos
                  </th>
                  <th scope="col" className={`${TH_RIGHT} max-md:hidden`}>
                    Movimentações
                  </th>
                  <th scope="col" className={`${TH} max-lg:hidden`}>
                    Estratégia
                  </th>
                  <th scope="col" className={`${TH} max-lg:hidden`}>
                    Objetivo
                  </th>
                  <th scope="col" className="w-40">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {settings.portfolios.map((portfolio, index) => (
                  <tr
                    key={portfolio.id}
                    className={`${ROW} ${dragging === portfolio.id ? 'opacity-50' : ''}`}
                    draggable={!busy}
                    onDragStart={() => setDragging(portfolio.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      const from = settings.portfolios.findIndex(
                        (item) => item.id === dragging,
                      );
                      setDragging(null);
                      if (from !== -1 && from !== index) void move(from, index - from);
                    }}
                    onDragEnd={() => setDragging(null)}
                  >
                    <td className="pl-3">
                      <button
                        type="button"
                        aria-label={`Reordenar ${portfolio.name}: setas para cima e para baixo`}
                        title="Arraste, ou use as setas, para mudar a ordem"
                        disabled={busy}
                        className="cursor-grab text-ink-3 hover:text-ink-2"
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            void move(index, -1);
                          } else if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            void move(index, 1);
                          }
                        }}
                      >
                        <Icon name="grip" />
                      </button>
                    </td>
                    <th scope="row" className="pl-1 text-left font-semibold">
                      {portfolio.name}
                    </th>
                    <td className={`${TD} tabular text-right`}>
                      {portfolio.value === null
                        ? '—'
                        : formatMoney(portfolio.value, { hidden }).text}
                    </td>
                    <td className={`${TD} tabular text-right max-md:hidden`}>
                      {portfolio.blocking.assets}
                    </td>
                    <td
                      className={`${TD} tabular text-right max-md:hidden`}
                      title="Excluir a carteira exclui também estas movimentações"
                    >
                      {portfolio.blocking.transactions}
                    </td>
                    <td className={`${TD} text-ink-2 max-lg:hidden`}>
                      {portfolio.strategy_categories === 0
                        ? 'sem estratégia'
                        : plural(portfolio.strategy_categories, 'classe', 'classes')}
                    </td>
                    <td className={`${TD} text-ink-2 max-lg:hidden`}>
                      {portfolio.goal ?? 'sem objetivo'}
                    </td>
                    <td className="pr-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        aria-label={`Renomear ${portfolio.name}`}
                        className="cursor-pointer text-accent hover:underline"
                        onClick={() => setEditing({ kind: 'edit', item: portfolio })}
                      >
                        Renomear
                      </button>
                      <span aria-hidden="true" className="px-1.5 text-ink-3">
                        ·
                      </span>
                      <button
                        type="button"
                        aria-label={`Arquivar ${portfolio.name}`}
                        disabled={busy}
                        className="cursor-pointer text-accent hover:underline disabled:opacity-60"
                        onClick={() =>
                          void apply(() => archivePortfolio(portfolio.id, true))
                        }
                      >
                        Arquivar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <PanelFootnote>
            Arraste para mudar a ordem: é a ordem do seletor na barra lateral. Estratégia
            e objetivo são editados nas telas da carteira.
          </PanelFootnote>
          {failure === null ? null : (
            <p
              role="alert"
              className="border-t border-line px-4 py-2 text-[0.8125rem] text-negative"
            >
              {failure}
            </p>
          )}
        </SettingsPanel>

        <SettingsPanel
          title="Arquivadas"
          hint="saem do seletor; o histórico fica guardado"
        >
          {settings.archived_portfolios.length === 0 ? (
            <p className="px-4 py-4 text-[0.8125rem] text-ink-2">
              Nenhuma carteira arquivada. Arquivar exige que a carteira esteja sem
              posições abertas ou que você transfira as posições antes.
            </p>
          ) : (
            <ul aria-label="Carteiras arquivadas">
              {settings.archived_portfolios.map((portfolio) => (
                <li
                  key={portfolio.id}
                  className="flex h-(--row-height) items-center justify-between gap-3 border-t border-line px-4 text-[0.8125rem] first:border-t-0"
                >
                  <span>
                    {portfolio.name}{' '}
                    <Muted>
                      arquivada em {portfolio.archived_on.split('-').reverse().join('/')}
                    </Muted>
                  </span>
                  <button
                    type="button"
                    aria-label={`Reativar ${portfolio.name}`}
                    disabled={busy}
                    className="cursor-pointer text-accent hover:underline disabled:opacity-60"
                    onClick={() =>
                      void apply(() => archivePortfolio(portfolio.id, false))
                    }
                  >
                    Reativar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SettingsPanel>
      </SettingsSection>
      {editing.kind === 'create' || editing.kind === 'edit' ? (
        <PortfolioDialog
          portfolio={editing.kind === 'edit' ? editing.item : null}
          onClose={() => setEditing(NONE)}
          onSaved={done}
          onDelete={
            editing.kind === 'edit'
              ? () => setEditing({ kind: 'delete', item: editing.item })
              : undefined
          }
        />
      ) : null}
      {editing.kind === 'delete' ? (
        <DeletePortfolioDialog
          portfolio={editing.item}
          onClose={() => setEditing(NONE)}
          onDone={done}
        />
      ) : null}
    </>
  );
};
