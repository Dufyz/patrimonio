import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';

import { cn } from '../lib/cn.js';
import { Icon } from './icon.js';
import { Button, Kbd } from './primitives.js';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.js';
import { useDismiss } from './use_dismiss.js';

/**
 * D-12 · Menus, dicas e confirmações.
 *
 * Três regras valem para todas as sobreposições desta aplicação, e estão
 * implementadas uma vez só:
 *
 * 1. fecham com Esc e com clique fora;
 * 2. devolvem o foco ao elemento que as abriu — quem usa teclado, sem isso,
 *    volta para o começo do documento a cada menu fechado;
 * 3. ação destrutiva fica por último, separada por uma linha e em vermelho,
 *    longe do item que a pessoa queria clicar.
 */

export type MenuItemSpec = {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly shortcut?: string | undefined;
  readonly icon?: React.ReactNode;
  readonly destructive?: boolean | undefined;
  /** Linha separadora acima do item: agrupa as ações como a prancha 05 agrupa. */
  readonly separatorBefore?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly onSelect: () => void;
};

/**
 * O menu de contexto (`···`). É o `DropdownMenu` do shadcn — Radix cuida do
 * foco, do teclado e do clique fora — com a pele da prancha 16. A ação
 * destrutiva vem por último, separada por uma linha.
 */
export const Menu = ({
  label,
  items,
  variant = 'row',
}: {
  readonly label: string;
  readonly items: readonly MenuItemSpec[];
  /**
   * `row` é o `···` da linha de tabela: em repouso são só os três pontos, e a
   * moldura do botão aparece no mouse e com o menu aberto (prancha 05). `button`
   * é o botão de ícone com moldura sempre, para o cabeçalho de uma tela.
   */
  readonly variant?: 'row' | 'button';
}): React.ReactElement => {
  const ordinary = items.filter((item) => item.destructive !== true);
  const destructive = items.filter((item) => item.destructive === true);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex cursor-pointer items-center justify-center rounded-control border text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-focus/40',
            variant === 'row'
              ? 'size-7 border-transparent bg-transparent hover:border-line-2 hover:bg-panel data-[state=open]:border-line-2 data-[state=open]:bg-panel'
              : 'size-control border-line-2 bg-panel hover:bg-panel-2 data-[state=open]:bg-panel-2',
          )}
        >
          <Icon name="dots" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={label}>
        {ordinary.map((item) => (
          <MenuEntry key={item.id} item={item} />
        ))}
        {destructive.length === 0 ? null : (
          <>
            <DropdownMenuSeparator />
            {destructive.map((item) => (
              <MenuEntry key={item.id} item={item} />
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const MenuEntry = ({ item }: { readonly item: MenuItemSpec }): React.ReactElement => (
  <>
    {item.separatorBefore === true ? <DropdownMenuSeparator /> : null}
    <MenuItemRow item={item} />
  </>
);

const MenuItemRow = ({ item }: { readonly item: MenuItemSpec }): React.ReactElement => (
  <DropdownMenuItem
    disabled={item.disabled === true}
    destructive={item.destructive === true}
    onSelect={() => item.onSelect()}
  >
    <span className="flex min-w-0 items-center gap-2.5">
      {item.icon === undefined ? null : (
        <span aria-hidden="true" className="text-ink-2">
          {item.icon}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate">{item.label}</span>
        {item.hint === undefined ? null : (
          <span className="block truncate text-xs text-ink-3">{item.hint}</span>
        )}
      </span>
    </span>
    {item.shortcut === undefined ? null : <Kbd>{item.shortcut}</Kbd>}
  </DropdownMenuItem>
);

/**
 * Dica de informação. Abre no foco e no mouse, e fecha com Esc — a dica que só
 * abre no mouse é uma dica que quem usa teclado nunca lê.
 */
export const InfoTip = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLSpanElement>(null);
  const tipId = useId();

  useDismiss(container, open, () => setOpen(false));

  return (
    <span
      ref={container}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? tipId : undefined}
        className="inline-flex size-4 cursor-help items-center justify-center rounded-full text-ink-3 hover:text-ink-2"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Icon name="info" size={14} />
      </button>
      {open ? (
        <span
          id={tipId}
          role="tooltip"
          className="absolute top-6 left-0 z-30 w-64 rounded-control border border-line-2 bg-panel p-2 text-xs text-ink-2 shadow-menu"
        >
          {children}
        </span>
      ) : null}
    </span>
  );
};

/**
 * Modal — o `Dialog` do shadcn (Radix). Prende o foco enquanto está aberto, fecha
 * com Esc e com clique fora, e devolve o foco a quem o abriu; o que a prancha 13
 * define está em `ui/dialog.tsx`: cabeçalho, corpo e rodapé sobre `panel-2`.
 *
 * `data-autofocus` marca o campo que recebe o foco ao abrir.
 */
const ModalCloseContext = createContext<(() => void) | null>(null);

/**
 * O "fechar" de dentro de um modal. Quando o modal protege alterações, o botão
 * Cancelar do formulário passa pelo mesmo aviso do X e do Esc; fora de um modal
 * protegido, é a função que o formulário já tinha.
 */
export const useRequestClose = (fallback: () => void): (() => void) =>
  useContext(ModalCloseContext) ?? fallback;

/** O que, ao ser clicado dentro do modal, é uma escolha da pessoa e não navegação. */
const CHOICE = '[role="option"],[role="checkbox"],[role="switch"],[role="radio"]';

/**
 * O segundo passo de toda ação sem volta e de todo descarte: um aviso curto,
 * por cima do modal, com o botão seguro em foco. Clique acidental no X, no Esc
 * ou fora do modal cai aqui em vez de perder o que foi digitado.
 */
export const AlertModal = ({
  open,
  title,
  message,
  cancelLabel,
  confirmLabel,
  danger = true,
  pending = false,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly message: React.ReactNode;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly danger?: boolean;
  readonly pending?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.ReactElement => (
  <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
    <DialogContent
      className="max-w-[26rem]"
      onOpenAutoFocus={(event) => {
        const target = event.currentTarget;
        if (!(target instanceof globalThis.HTMLElement)) return;
        const wanted = target.querySelector<HTMLElement>('[data-autofocus]');
        if (wanted === null) return;
        event.preventDefault();
        wanted.focus();
      }}
    >
      <DialogHeader>
        <div className="min-w-0">
          <DialogTitle>{title}</DialogTitle>
        </div>
      </DialogHeader>
      <DialogBody>
        <p className="text-sm">{message}</p>
      </DialogBody>
      <DialogFooter>
        <span />
        <div className="flex items-center gap-2">
          <Button data-autofocus onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export const Modal = ({
  title,
  subtitle,
  open,
  onClose,
  footer,
  narrow = false,
  tone,
  guard = false,
  children,
}: {
  readonly narrow?: boolean;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly footer?: React.ReactNode;
  /** `danger` põe o ícone de lixeira à frente do título, como a prancha 13 D. */
  readonly tone?: 'danger' | undefined;
  /**
   * Modal que cria ou edita: fechar com alteração feita (X, Esc, clique fora ou
   * Cancelar) pergunta antes de descartar. Sem alteração, fecha direto — não há
   * o que perder.
   */
  readonly guard?: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement | null => {
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!open) {
      setDirty(false);
      setAsking(false);
    }
  }, [open]);

  const requestClose = (): void => {
    if (guard && dirty) setAsking(true);
    else onClose();
  };

  const markDirty = (): void => {
    if (guard && !dirty) setDirty(true);
  };

  return (
    <ModalCloseContext.Provider value={guard ? requestClose : null}>
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : requestClose())}>
        <DialogContent
          className={narrow ? 'max-w-[35rem]' : 'max-w-2xl'}
          onInputCapture={markDirty}
          onChangeCapture={markDirty}
          onClickCapture={(event) => {
            if (
              event.target instanceof globalThis.Element &&
              event.target.closest(CHOICE) !== null
            ) {
              markDirty();
            }
          }}
          onOpenAutoFocus={(event) => {
            const target = event.currentTarget;
            if (!(target instanceof globalThis.HTMLElement)) return;
            const wanted = target.querySelector<HTMLElement>('[data-autofocus]');
            if (wanted === null) return;
            event.preventDefault();
            wanted.focus();
          }}
        >
          <DialogHeader>
            {tone === 'danger' ? (
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-full bg-negative-soft text-negative"
              >
                <Icon name="trash" />
              </span>
            ) : null}
            <div className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              {subtitle === undefined ? null : (
                <DialogDescription className="truncate">{subtitle}</DialogDescription>
              )}
            </div>
          </DialogHeader>

          <DialogBody>{children}</DialogBody>

          {footer === undefined ? null : <DialogFooter>{footer}</DialogFooter>}

          <AlertModal
            open={asking}
            title="Descartar alterações?"
            message="O que você preencheu neste formulário será perdido."
            cancelLabel="Continuar editando"
            confirmLabel="Descartar"
            onCancel={() => setAsking(false)}
            onConfirm={() => {
              setAsking(false);
              onClose();
            }}
          />
        </DialogContent>
      </Dialog>
    </ModalCloseContext.Provider>
  );
};

/**
 * Confirmação de exclusão. Nomeia exatamente o que será excluído, e nomear
 * significa dizer "a carteira Longo prazo, com 28 posições" — "este item" é a
 * frase que faz alguém apagar a coisa errada.
 */
export const ConfirmDialog = ({
  open,
  title,
  subject,
  consequence,
  confirmLabel = 'Excluir',
  onConfirm,
  onCancel,
}: {
  readonly open: boolean;
  readonly title: string;
  /** O que exatamente será excluído. */
  readonly subject: string;
  readonly consequence?: string | undefined;
  readonly confirmLabel?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): React.ReactElement | null => {
  // Exclusão pede duas confirmações: o modal que nomeia o que sai, e um aviso
  // final que só executa no segundo "sim".
  const [final, setFinal] = useState(false);

  useEffect(() => {
    if (!open) setFinal(false);
  }, [open]);

  return (
    <Modal
      open={open}
      title={title}
      tone="danger"
      narrow
      onClose={onCancel}
      footer={
        <>
          <span />
          <div className="flex items-center gap-2">
            <Button onClick={onCancel}>Cancelar</Button>
            <Button variant="danger" data-autofocus onClick={() => setFinal(true)}>
              {confirmLabel}
            </Button>
          </div>
        </>
      }
    >
      <p className="text-sm">
        Será excluído: <strong className="font-semibold">{subject}</strong>
      </p>
      {consequence === undefined ? null : (
        <p className={cn('text-[0.8125rem] text-ink-2')}>{consequence}</p>
      )}
      <FinalDeleteAlert
        open={final}
        subject={subject}
        onCancel={() => setFinal(false)}
        onConfirm={() => {
          setFinal(false);
          onConfirm();
        }}
      />
    </Modal>
  );
};

/** O segundo passo de toda exclusão: dá nome ao que sai e avisa que não volta. */
export const FinalDeleteAlert = ({
  open,
  subject,
  pending = false,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly subject: string;
  readonly pending?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.ReactElement => (
  <AlertModal
    open={open}
    title="Tem certeza?"
    message={
      <>
        <strong className="font-semibold">{subject}</strong> será excluído e essa ação não
        pode ser desfeita.
      </>
    }
    cancelLabel="Voltar"
    confirmLabel="Sim, excluir"
    pending={pending}
    onCancel={onCancel}
    onConfirm={onConfirm}
  />
);
