import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { DeletionReceipt } from '../api/transactions.js';
import { undoDeletion } from '../api/transactions.js';
import { fetchSettings } from '../api/settings.js';
import type { SaveReceipt } from '../api/entry.js';
import {
  ENTRY_TABS,
  pickInstitution,
  pickPortfolio,
  referenceOf,
  todayDateOnly,
} from '../lib/entry.js';
import type { EntryReference, EntryTab } from '../lib/entry.js';
import { browserStorage, readRaw, writeRaw } from '../lib/preferences.js';
import type { PickedAsset } from '../views/entry/asset_picker.js';
import type { AssetSearch } from '../views/entry/asset_picker.js';
import { CashFormView } from '../views/entry/cash_form.js';
import { ConfirmEntry } from '../views/entry/confirm_form.js';
import { EditEntry } from '../views/entry/edit_form.js';
import { PayoutFormView } from '../views/entry/payout_form.js';
import { TradeFormView } from '../views/entry/trade_form.js';
import type { TradeSeed } from '../views/entry/trade_form.js';
import { TransferFormView } from '../views/entry/transfer_form.js';
import { Modal } from './overlay.js';
import { Button } from './primitives.js';
import { useShortcuts } from './shortcuts.js';

/**
 * T-10 · Quem abre os modais de lançamento.
 *
 * Um provedor só, no alto da área de trabalho, porque "Lançar" existe em quatro
 * lugares (cabeçalho de Posições, página do ativo, extrato, paleta) e o atalho
 * `N` em todos. Cada tela pede `openEntry(...)` e não sabe nada de formulário.
 *
 * `version` sobe a cada gravação confirmada pela `api`: as telas que listam
 * posições e lançamentos releem quando ele muda. Não há atualização otimista —
 * o número novo só aparece depois que o recálculo, que é da `api`, o produz.
 */

export type OpenEntryRequest = {
  readonly tab?: EntryTab;
  readonly asset?: PickedAsset | null;
  readonly portfolioId?: string | null;
  readonly seed?: Pick<TradeSeed, 'quantity' | 'price' | 'fees' | 'note'>;
};

export type EntryApi = {
  readonly openEntry: (request?: OpenEntryRequest) => void;
  readonly openEdit: (transactionId: string, assetLabel?: string) => void;
  readonly openConfirmPayout: (transactionId: string, assetLabel?: string) => void;
  /** Sobe a cada gravação: as telas que mostram lançamentos releem com ele. */
  readonly version: number;
};

const EntryContext = createContext<EntryApi | null>(null);

const NOOP_API: EntryApi = {
  openEntry: () => {},
  openEdit: () => {},
  openConfirmPayout: () => {},
  version: 0,
};

export const useEntry = (): EntryApi => useContext(EntryContext) ?? NOOP_API;

export const LAST_INSTITUTION_KEY = 'patrimonio.entry.institution';

type Dialog =
  | { readonly kind: 'entry'; readonly tab: EntryTab; readonly request: OpenEntryRequest }
  | { readonly kind: 'edit'; readonly id: string; readonly label?: string }
  | { readonly kind: 'confirm'; readonly id: string; readonly label?: string };

type Notice =
  | { readonly kind: 'saved'; readonly message: string }
  | { readonly kind: 'deleted'; readonly undoId: string };

type Reference =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly reference: EntryReference };

const NOTICE_MS = 8000;

export const EntryProvider = ({
  scopePortfolioId,
  search,
  children,
}: {
  /** A carteira do escopo atual; "Todas" é `null`, e a primeira carteira entra no lugar. */
  readonly scopePortfolioId: string | null;
  /** Troca-se nos testes para não depender da rede. */
  readonly search?: AssetSearch;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [opened, setOpened] = useState(0);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reference, setReference] = useState<Reference>({ status: 'loading' });

  // A lista de carteiras e instituições é lida a cada abertura: criar uma
  // carteira em Configurações e lançar nela em seguida não pode exigir recarregar.
  useEffect(() => {
    if (dialog === null) return;
    const controller = new AbortController();
    setReference({ status: 'loading' });

    fetchSettings(controller.signal)
      .then((settings) => {
        if (!controller.signal.aborted) {
          setReference({ status: 'ready', reference: referenceOf(settings) });
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setReference({
          status: 'error',
          message: cause instanceof Error ? cause.message : 'A api não respondeu',
        });
      });

    return () => controller.abort();
    // `opened` e não `dialog`: trocar de aba não precisa reler.
  }, [opened]);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const open = useCallback((next: Dialog) => {
    setDialog(next);
    setOpened((count) => count + 1);
  }, []);

  const openEntry = useCallback(
    (request: OpenEntryRequest = {}) =>
      open({ kind: 'entry', tab: request.tab ?? 'buy', request }),
    [open],
  );
  const openEdit = useCallback(
    (id: string, label?: string) =>
      open({ kind: 'edit', id, ...(label === undefined ? {} : { label }) }),
    [open],
  );
  const openConfirmPayout = useCallback(
    (id: string, label?: string) =>
      open({ kind: 'confirm', id, ...(label === undefined ? {} : { label }) }),
    [open],
  );

  const close = useCallback(() => setDialog(null), []);

  const saved = useCallback((receipt: SaveReceipt, institutionId?: string | null) => {
    if (institutionId !== undefined && institutionId !== null) {
      writeRaw(browserStorage(), LAST_INSTITUTION_KEY, institutionId);
    }
    setVersion((current) => current + 1);
    setNotice({
      kind: 'saved',
      message: receipt.queued
        ? `${receipt.message} O recálculo está na fila; os números novos aparecem em instantes.`
        : receipt.message,
    });
  }, []);

  const deleted = useCallback((receipt: DeletionReceipt) => {
    setDialog(null);
    setVersion((current) => current + 1);
    setNotice({ kind: 'deleted', undoId: receipt.undo.undo_id });
  }, []);

  const undo = async (undoId: string): Promise<void> => {
    try {
      await undoDeletion(undoId);
      setNotice({ kind: 'saved', message: 'Exclusão desfeita.' });
    } catch (cause) {
      setNotice({
        kind: 'saved',
        message: cause instanceof Error ? cause.message : 'Não foi possível desfazer.',
      });
    }
    setVersion((current) => current + 1);
  };

  const shortcuts = useMemo(() => ({ new_transaction: () => openEntry() }), [openEntry]);
  useShortcuts(shortcuts);

  const api = useMemo<EntryApi>(
    () => ({ openEntry, openEdit, openConfirmPayout, version }),
    [openEntry, openEdit, openConfirmPayout, version],
  );

  const title =
    dialog?.kind === 'edit'
      ? 'Editar lançamento'
      : dialog?.kind === 'confirm'
        ? 'Confirmar recebimento'
        : 'Novo lançamento';

  return (
    <EntryContext.Provider value={api}>
      {children}

      <Modal title={title} open={dialog !== null} onClose={close}>
        {dialog === null ? null : reference.status === 'loading' ? (
          <p className="py-6 text-center text-sm text-ink-3">Carregando…</p>
        ) : reference.status === 'error' ? (
          <div className="flex flex-col gap-3">
            <p
              role="alert"
              className="rounded-control bg-negative-soft px-3 py-2 text-sm text-negative"
            >
              {reference.message}
            </p>
            <div className="flex justify-end">
              <Button onClick={close}>Fechar</Button>
            </div>
          </div>
        ) : dialog.kind === 'edit' ? (
          <EditEntry
            transactionId={dialog.id}
            reference={reference.reference}
            assetLabel={dialog.label}
            onSaved={(receipt) => {
              saved(receipt);
              close();
            }}
            onDeleted={deleted}
            onCancel={close}
          />
        ) : dialog.kind === 'confirm' ? (
          <ConfirmEntry
            transactionId={dialog.id}
            assetLabel={dialog.label}
            onSaved={(receipt) => {
              saved(receipt);
              close();
            }}
            onCancel={close}
          />
        ) : (
          <EntryForms
            // Nova abertura, novo formulário: nada do lançamento anterior sobra.
            key={opened}
            tab={dialog.tab}
            request={dialog.request}
            reference={reference.reference}
            scopePortfolioId={scopePortfolioId}
            {...(search === undefined ? {} : { search })}
            onTab={(tab) => setDialog({ ...dialog, tab })}
            onSaved={(receipt, again, institutionId) => {
              saved(receipt, institutionId);
              // "Salvar e novo": o formulário se limpa sozinho e o modal continua.
              if (!again) close();
            }}
            onCancel={close}
          />
        )}
      </Modal>

      {notice === null ? null : (
        <div
          role="status"
          className="fixed right-6 bottom-6 z-50 flex max-w-md items-center gap-3 rounded-panel border border-line bg-panel px-4 py-3 text-sm shadow-lg"
        >
          <span>{notice.kind === 'saved' ? notice.message : 'Lançamento excluído.'}</span>
          {notice.kind === 'deleted' ? (
            <Button onClick={() => void undo(notice.undoId)}>Desfazer</Button>
          ) : null}
        </div>
      )}
    </EntryContext.Provider>
  );
};

/** As abas e o formulário da aba ativa. */
const EntryForms = ({
  tab,
  request,
  reference,
  scopePortfolioId,
  search,
  onTab,
  onSaved,
  onCancel,
}: {
  readonly tab: EntryTab;
  readonly request: OpenEntryRequest;
  readonly reference: EntryReference;
  readonly scopePortfolioId: string | null;
  readonly search?: AssetSearch;
  readonly onTab: (tab: EntryTab) => void;
  readonly onSaved: (
    receipt: SaveReceipt,
    again: boolean,
    institutionId: string | null,
  ) => void;
  readonly onCancel: () => void;
}): React.ReactElement => {
  const remembered = useMemo(() => readRaw(browserStorage(), LAST_INSTITUTION_KEY), []);
  const today = useMemo(() => todayDateOnly(), []);

  const portfolioId =
    request.portfolioId === undefined
      ? pickPortfolio(reference, scopePortfolioId)
      : request.portfolioId;
  const institutionId = pickInstitution(reference, remembered);
  const asset = request.asset ?? null;
  const searchProps = search === undefined ? {} : { search };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Tipo de lançamento"
        className="flex flex-wrap gap-1 border-b border-line"
      >
        {ENTRY_TABS.map((item) => {
          const active = item.id === tab;
          const unavailable = item.unavailable;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={unavailable !== undefined}
              title={unavailable}
              className={`-mb-px cursor-pointer border-b-2 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:text-ink-3 ${
                active ? 'border-accent font-semibold' : 'border-transparent text-ink-2'
              }`}
              onClick={() => onTab(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'buy' || tab === 'sell' ? (
        <TradeFormView
          key={tab}
          kind={tab}
          reference={reference}
          seed={{
            asset,
            portfolioId,
            institutionId,
            date: today,
            ...request.seed,
          }}
          {...searchProps}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      ) : tab === 'payout' ? (
        <PayoutFormView
          reference={reference}
          seed={{ asset, portfolioId, institutionId, date: today }}
          {...searchProps}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      ) : tab === 'deposit' || tab === 'withdrawal' ? (
        <CashFormView
          key={tab}
          kind={tab}
          reference={reference}
          seed={{ portfolioId, institutionId, date: today }}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      ) : tab === 'transfer' ? (
        <TransferFormView
          reference={reference}
          seed={{ asset, fromPortfolioId: portfolioId, institutionId, date: today }}
          {...searchProps}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      ) : null}
    </div>
  );
};
