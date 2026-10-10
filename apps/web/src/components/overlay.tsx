import { useEffect, useId, useRef, useState } from 'react';

import { Button, Kbd } from './primitives.js';
import { useDismiss } from './use_dismiss.js';

/**
 * D-12 · Menus, dicas e confirmações.
 *
 * Três regras valem para todas as sobreposições desta aplicação, e estão
 * implementadas uma vez só:
 *
 * 1. fecham com Esc e com clique fora (`useDismiss`);
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
  readonly disabled?: boolean | undefined;
  readonly onSelect: () => void;
};

export const Menu = ({
  label,
  items,
  trigger,
}: {
  readonly label: string;
  readonly items: readonly MenuItemSpec[];
  /** O botão que abre; recebe as propriedades de acessibilidade. */
  readonly trigger?: ((props: TriggerProps) => React.ReactElement) | undefined;
}): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useDismiss(container, open, close);

  const ordinary = items.filter((item) => item.destructive !== true);
  const destructive = items.filter((item) => item.destructive === true);

  const triggerProps: TriggerProps = {
    ref: triggerRef,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': menuId,
    onClick: () => setOpen((current) => !current),
  };

  return (
    <div ref={container} className="relative inline-flex">
      {trigger === undefined ? (
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-control text-ink-3 hover:bg-panel-2 hover:text-ink"
          {...triggerProps}
        >
          ···
        </button>
      ) : (
        trigger(triggerProps)
      )}

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute top-8 right-0 z-30 min-w-56 rounded-panel border border-line bg-panel py-1 shadow-lg"
        >
          {ordinary.map((item) => (
            <MenuEntry key={item.id} item={item} onDone={close} />
          ))}
          {destructive.length === 0 ? null : (
            <div className="mt-1 border-t border-line pt-1">
              {destructive.map((item) => (
                <MenuEntry key={item.id} item={item} onDone={close} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

export type TriggerProps = {
  readonly ref: React.RefObject<HTMLButtonElement | null>;
  readonly 'aria-haspopup': 'menu';
  readonly 'aria-expanded': boolean;
  readonly 'aria-controls': string;
  readonly onClick: () => void;
};

const MenuEntry = ({
  item,
  onDone,
}: {
  readonly item: MenuItemSpec;
  readonly onDone: () => void;
}): React.ReactElement => (
  <button
    type="button"
    role="menuitem"
    disabled={item.disabled === true}
    className={`flex w-full cursor-pointer items-start gap-2.5 px-3 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:text-ink-3 ${
      item.destructive === true
        ? 'text-negative hover:bg-negative-soft'
        : 'hover:bg-panel-2'
    }`}
    onClick={() => {
      item.onSelect();
      onDone();
    }}
  >
    {item.icon === undefined ? null : (
      <span aria-hidden="true" className="mt-0.5 text-ink-3">
        {item.icon}
      </span>
    )}
    <span className="min-w-0 flex-1">
      <span className="block truncate">{item.label}</span>
      {item.hint === undefined ? null : (
        <span className="block truncate text-[0.75rem] text-ink-3">{item.hint}</span>
      )}
    </span>
    {item.shortcut === undefined ? null : <Kbd>{item.shortcut}</Kbd>}
  </button>
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
        className="inline-flex size-4 cursor-help items-center justify-center rounded-full border border-line text-[0.625rem] text-ink-3"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      {open ? (
        <span
          id={tipId}
          role="tooltip"
          className="absolute top-6 left-0 z-30 w-64 rounded-control border border-line bg-panel p-2 text-[0.75rem] text-ink-2 shadow-lg"
        >
          {children}
        </span>
      ) : null}
    </span>
  );
};

/**
 * Modal. Prende o foco dentro dele enquanto estiver aberto, porque um modal do
 * qual o Tab escapa deixa a pessoa editando o formulário de trás sem perceber.
 */
export const Modal = ({
  title,
  subtitle,
  open,
  onClose,
  footer,
  narrow = false,
  children,
}: {
  readonly narrow?: boolean;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly footer?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.ReactElement | null => {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const opener = useRef<Element | null>(null);

  useDismiss(panel, open, onClose);

  useEffect(() => {
    if (!open) return;
    opener.current = globalThis.document.activeElement;
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    return () => {
      if (opener.current instanceof globalThis.HTMLElement) opener.current.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-overlay p-8">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full ${narrow ? 'max-w-[35rem]' : 'max-w-2xl'} rounded-panel border border-line bg-panel shadow-xl`}
        onKeyDown={(event) => trapTab(event, panel.current)}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold">
              {title}
            </h2>
            {subtitle === undefined ? null : (
              <p className="truncate text-[0.8125rem] text-ink-3">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Fechar"
            className="cursor-pointer text-ink-3 hover:text-ink"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="px-5 py-4">{children}</div>

        {footer === undefined ? null : (
          <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const trapTab = (event: React.KeyboardEvent, panel: HTMLElement | null): void => {
  if (event.key !== 'Tab' || panel === null) return;

  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) return;

  const active = globalThis.document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
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
}): React.ReactElement | null => (
  <Modal
    open={open}
    title={title}
    onClose={onCancel}
    footer={
      <>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button variant="destructive" data-autofocus onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </>
    }
  >
    <p className="text-sm">
      Será excluído: <strong className="font-semibold">{subject}</strong>
    </p>
    {consequence === undefined ? null : (
      <p className="mt-2 text-[0.8125rem] text-ink-2">{consequence}</p>
    )}
  </Modal>
);
