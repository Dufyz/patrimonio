import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { Shortcut } from '../lib/shortcuts.js';
import {
  SCOPE_TITLES,
  describeShortcut,
  groupShortcuts,
  resolveShortcut,
} from '../lib/shortcuts.js';
import { Modal } from './overlay.js';
import { usePreferences } from './preferences.js';

/**
 * D-11 · Os atalhos ligados à aplicação.
 *
 * Um ouvinte só, no documento. Cada tela registra o que fazer com cada atalho
 * e o registro some quando a tela sai — assim `E` edita a linha em Posições e
 * não faz nada em Configurações, sem que nenhuma das duas precise saber da
 * outra.
 *
 * A sequência de duas teclas expira: começar `G` e parar não deixa a aplicação
 * esperando a segunda tecla para sempre.
 */

const SEQUENCE_TIMEOUT_MS = 1200;

export type ShortcutHandlers = Readonly<Record<string, (() => void) | undefined>>;

type ShortcutRegistry = {
  readonly register: (handlers: ShortcutHandlers) => () => void;
  readonly openHelp: () => void;
};

const ShortcutContext = createContext<ShortcutRegistry | null>(null);

export const ShortcutProvider = ({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const layers = useRef<ShortcutHandlers[]>([]);
  const buffer = useRef<readonly string[]>([]);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const { toggleHidden } = usePreferences();

  const register = useCallback((handlers: ShortcutHandlers) => {
    layers.current = [...layers.current, handlers];
    return () => {
      layers.current = layers.current.filter((entry) => entry !== handlers);
    };
  }, []);

  const openHelp = useCallback(() => setHelpOpen(true), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const resolved = resolveShortcut(buffer.current, event);
      buffer.current = resolved.buffer;

      if (expiry.current !== null) clearTimeout(expiry.current);
      if (resolved.buffer.length > 0) {
        expiry.current = setTimeout(() => {
          buffer.current = [];
        }, SEQUENCE_TIMEOUT_MS);
      }

      const shortcut = resolved.shortcut;
      if (shortcut === null) return;

      if (shortcut.id === 'help') {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (shortcut.id === 'hide_values') {
        event.preventDefault();
        toggleHidden();
        return;
      }

      // A camada mais recente ganha: um modal aberto responde antes da tela.
      for (const handlers of [...layers.current].reverse()) {
        const handler = handlers[shortcut.id];
        if (handler !== undefined) {
          event.preventDefault();
          handler();
          return;
        }
      }
    };

    globalThis.document.addEventListener('keydown', onKeyDown);
    return () => globalThis.document.removeEventListener('keydown', onKeyDown);
  }, [toggleHidden]);

  const value = useMemo<ShortcutRegistry>(
    () => ({ register, openHelp }),
    [register, openHelp],
  );

  return (
    <ShortcutContext.Provider value={value}>
      {children}
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </ShortcutContext.Provider>
  );
};

/**
 * Registra os atalhos de uma tela. O objeto é lido por referência, então quem
 * chama deve memoizá-lo — é o que mantém o registro estável entre renders.
 */
export const useShortcuts = (handlers: ShortcutHandlers): void => {
  const registry = useContext(ShortcutContext);

  useEffect(() => {
    if (registry === null) return;
    return registry.register(handlers);
  }, [registry, handlers]);
};

export const useShortcutHelp = (): (() => void) => {
  const registry = useContext(ShortcutContext);
  return registry?.openHelp ?? (() => {});
};

/** A ajuda, gerada da mesma lista que os atalhos usam. */
const ShortcutHelp = ({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}): React.ReactElement | null => (
  <Modal open={open} title="Atalhos de teclado" onClose={onClose}>
    <div className="grid gap-6 sm:grid-cols-2">
      {groupShortcuts().map((group) => (
        <section key={group.scope}>
          <h3 className="mb-2 text-label tracking-wide text-ink-3 uppercase">
            {SCOPE_TITLES[group.scope]}
          </h3>
          <dl className="flex flex-col gap-1">
            {group.items.map((shortcut: Shortcut) => (
              <div key={shortcut.id} className="flex items-center justify-between gap-4">
                <dt className="text-[0.8125rem] text-ink-2">{shortcut.label}</dt>
                <dd>
                  <kbd className="tabular rounded-xs border border-line bg-panel-2 px-1.5 py-0.5 text-[0.6875rem]">
                    {describeShortcut(shortcut)}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  </Modal>
);
