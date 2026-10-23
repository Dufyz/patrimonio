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
import { fetchInstitutions } from '../api/institutions.js';
import { fetchSettings } from '../api/settings.js';
import { SkeletonLines, SkeletonRegion } from './skeleton.js';
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
import type { EntryWizard } from '../views/entry/wizard.js';
import type { AssetSearch } from '../views/entry/asset_picker.js';
import { EventFormView } from '../views/entry/event_form.js';
import { ConfirmEntry } from '../views/entry/confirm_form.js';
import { EditEntry } from '../views/entry/edit_form.js';
import { PayoutFormView } from '../views/entry/payout_form.js';
import { TradeFormView } from '../views/entry/trade_form.js';
import type { TradeSeed } from '../views/entry/trade_form.js';
import { Modal } from './overlay.js';
import { Button, Segmented } from './primitives.js';
import { Field, FieldLabel } from '../views/entry/fields.js';
import { FormShell } from '../views/entry/form_shell.js';
import { AssetPicker } from '../views/entry/asset_picker.js';
import { EntrySummary } from '../views/entry/wizard.js';
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
  readonly seed?: Pick<TradeSeed, 'quantity' | 'price' | 'fees'>;
};

export type EntryStep = 'pick' | 'fill';

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
  // O primeiro passo escolhe a operação e o ativo; o segundo preenche. Quem abre
  // já com o ativo (a página dele, a paleta) começa no segundo.
  const [step, setStep] = useState<EntryStep>('pick');

  // A lista de carteiras e instituições é lida a cada abertura: criar uma
  // carteira em Configurações e lançar nela em seguida não pode exigir recarregar.
  useEffect(() => {
    if (dialog === null) return;
    const controller = new AbortController();
    setReference({ status: 'loading' });

    Promise.all([fetchSettings(controller.signal), fetchInstitutions(controller.signal)])
      .then(([settings, institutions]) => {
        if (!controller.signal.aborted) {
          setReference({
            status: 'ready',
            reference: referenceOf(settings, institutions),
          });
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
    (request: OpenEntryRequest = {}) => {
      setStep(request.asset === undefined || request.asset === null ? 'pick' : 'fill');
      open({ kind: 'entry', tab: request.tab ?? 'buy', request });
    },
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
        : 'Cadastrar transação';

  return (
    <EntryContext.Provider value={api}>
      {children}

      <Modal
        narrow={
          dialog?.kind === 'confirm' || (dialog?.kind === 'entry' && step === 'pick')
        }
        wide={dialog?.kind === 'edit' || (dialog?.kind === 'entry' && step === 'fill')}
        guard
        title={title}
        {...(dialog?.kind === 'entry'
          ? { aside: <StepIndicator step={step} /> }
          : dialog?.label === undefined
            ? {}
            : { subtitle: dialog.label })}
        open={dialog !== null}
        onClose={close}
      >
        {dialog === null ? null : reference.status === 'loading' ? (
          <SkeletonRegion label="Carregando" className="py-4">
            <SkeletonLines lines={5} />
          </SkeletonRegion>
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
            step={step}
            onStep={setStep}
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

/** "Passo 1 de 2" e os dois traços, no canto do cabeçalho. */
const StepIndicator = ({ step }: { readonly step: EntryStep }): React.ReactElement => (
  <span className="flex items-center gap-3 text-xs text-ink-3">
    Passo {step === 'pick' ? 1 : 2} de 2
    <span aria-hidden="true" className="flex gap-1">
      <span className="h-0.5 w-6 rounded-full bg-ink" />
      <span
        className={`h-0.5 w-6 rounded-full ${step === 'fill' ? 'bg-ink' : 'bg-line-2'}`}
      />
    </span>
  </span>
);

/** O assistente: escolher a operação e o ativo, depois preencher. */
export const EntryForms = ({
  tab,
  step,
  onStep,
  request,
  reference,
  scopePortfolioId,
  search,
  onTab,
  onSaved,
  onCancel,
}: {
  readonly tab: EntryTab;
  readonly step: EntryStep;
  readonly onStep: (step: EntryStep) => void;
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
  const [picked, setPicked] = useState<PickedAsset | null>(request.asset ?? null);

  const portfolioId =
    request.portfolioId === undefined
      ? pickPortfolio(reference, scopePortfolioId)
      : request.portfolioId;
  const institutionId = pickInstitution(reference, remembered);
  const asset = picked;
  const searchProps = search === undefined ? {} : { search };
  const trade = tab === 'buy' || tab === 'sell';
  const tabLabel = ENTRY_TABS.find((item) => item.id === tab)?.label ?? '';

  const operation = (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>Operação</FieldLabel>
      <div className="max-w-full overflow-x-auto">
        <Segmented
          label="Tipo de lançamento"
          options={ENTRY_TABS.map((item) => ({
            value: item.id,
            label: item.label,
          }))}
          value={tab}
          onChange={(next) => {
            onTab(next);
            // Só compra e venda aceitam um papel que ainda não é ativo.
            if (picked?.id === null && next !== 'buy' && next !== 'sell') setPicked(null);
          }}
        />
      </div>
    </div>
  );

  if (step === 'pick') {
    return (
      <FormShell
        pending={false}
        canSave={picked !== null}
        saveLabel="Próximo"
        saveShortcut={null}
        showCancel={false}
        onSave={() => {
          if (picked !== null) onStep('fill');
        }}
        onCancel={onCancel}
      >
        {operation}
        <Field label="Ativo">
          {(control) => (
            <AssetPicker
              control={control}
              invalid={false}
              portfolioId={portfolioId}
              value={picked}
              onChange={setPicked}
              allowNew={trade}
              autoFocus
              {...searchProps}
            />
          )}
        </Field>
      </FormShell>
    );
  }

  const wizard: EntryWizard = {
    summary: (
      <EntrySummary
        items={[
          { term: 'Ativo', value: picked?.label ?? '—' },
          ...(picked?.name === null || picked?.name === undefined
            ? []
            : [{ term: 'Nome', value: picked.name }]),
          { term: 'Operação', value: tabLabel },
          ...(picked?.held === null || picked?.held === undefined
            ? []
            : [{ term: 'Posição atual', value: picked.held }]),
        ]}
      />
    ),
    onBack: () => onStep('pick'),
    onAgain: () => {
      setPicked(null);
      onStep('pick');
    },
  };

  return (
    <div className="flex flex-col gap-4">
      {trade ? (
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
          wizard={wizard}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      ) : tab === 'payout' ? (
        <PayoutFormView
          reference={reference}
          seed={{ asset, portfolioId, institutionId, date: today }}
          {...searchProps}
          wizard={wizard}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      ) : (
        <EventFormView
          seed={{ asset, date: today }}
          {...searchProps}
          wizard={wizard}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      )}
    </div>
  );
};
