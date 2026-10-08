import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  HIDDEN_VALUES_SHORTCUT,
  readHiddenValues,
  writeHiddenValues,
} from '../lib/hidden_values.js';
import type { Storageish } from '../lib/preferences.js';
import { browserStorage } from '../lib/preferences.js';
import type { Density, ResolvedTheme, ThemePreference } from '../lib/theme.js';
import {
  applyThemeToDocument,
  readDensity,
  readThemePreference,
  resolveTheme,
  writeDensity,
  writeThemePreference,
} from '../lib/theme.js';

/**
 * D-01 e D-03 · As preferências de leitura, em um contexto só.
 *
 * Tema, densidade e valores ocultos têm o mesmo ciclo de vida — lidos do
 * navegador no primeiro quadro, escritos a cada mudança, aplicados no elemento
 * raiz — e todo componente de número depende do terceiro. Separá-los em três
 * contextos custaria três providers e três re-renders.
 */

export type PreferencesValue = {
  readonly theme: ThemePreference;
  readonly resolvedTheme: ResolvedTheme;
  readonly setTheme: (preference: ThemePreference) => void;
  readonly density: Density;
  readonly setDensity: (density: Density) => void;
  readonly hidden: boolean;
  readonly setHidden: (hidden: boolean) => void;
  readonly toggleHidden: () => void;
};

const PreferencesContext = createContext<PreferencesValue | null>(null);

const prefersDarkQuery = (): MediaQueryList | null => {
  if (typeof globalThis.matchMedia !== 'function') return null;
  return globalThis.matchMedia('(prefers-color-scheme: dark)');
};

type ProviderProps = {
  readonly children: React.ReactNode;
  /** Injetável para teste; em produção é o `localStorage` do navegador. */
  readonly storage?: Storageish | null;
};

export const PreferencesProvider = ({
  children,
  storage: injected,
}: ProviderProps): React.ReactElement => {
  const storage = useMemo(
    () => (injected === undefined ? browserStorage() : injected),
    [injected],
  );

  const [theme, setThemeState] = useState<ThemePreference>(() =>
    readThemePreference(storage),
  );
  const [density, setDensityState] = useState<Density>(() => readDensity(storage));
  const [hidden, setHiddenState] = useState<boolean>(() => readHiddenValues(storage));
  const [prefersDark, setPrefersDark] = useState<boolean>(
    () => prefersDarkQuery()?.matches ?? false,
  );

  // "Sistema" precisa reagir ao sistema, e não só ao recarregar: quem usa o
  // modo automático do macOS vê a tela trocar ao entardecer com a aba aberta.
  useEffect(() => {
    const query = prefersDarkQuery();
    if (query === null) return;

    const onChange = (event: MediaQueryListEvent): void => setPrefersDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme = resolveTheme(theme, prefersDark);

  useEffect(() => {
    applyThemeToDocument(globalThis.document.documentElement, resolvedTheme, density);
  }, [resolvedTheme, density]);

  const setTheme = useCallback(
    (preference: ThemePreference): void => {
      setThemeState(preference);
      writeThemePreference(storage, preference);
    },
    [storage],
  );

  const setDensity = useCallback(
    (next: Density): void => {
      setDensityState(next);
      writeDensity(storage, next);
    },
    [storage],
  );

  const setHidden = useCallback(
    (next: boolean): void => {
      setHiddenState(next);
      writeHiddenValues(storage, next);
    },
    [storage],
  );

  const toggleHidden = useCallback((): void => {
    setHiddenState((current) => {
      writeHiddenValues(storage, !current);
      return !current;
    });
  }, [storage]);

  const value = useMemo<PreferencesValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      density,
      setDensity,
      hidden,
      setHidden,
      toggleHidden,
    }),
    [
      theme,
      resolvedTheme,
      setTheme,
      density,
      setDensity,
      hidden,
      setHidden,
      toggleHidden,
    ],
  );

  return (
    <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
  );
};

export const usePreferences = (): PreferencesValue => {
  const value = useContext(PreferencesContext);
  if (value === null) {
    throw new Error('usePreferences precisa de um PreferencesProvider acima.');
  }
  return value;
};

/**
 * O que os componentes de número consultam. Existe para que nenhum deles
 * precise conhecer o contexto inteiro só para saber se esconde o valor.
 */
export const useValuesHidden = (): boolean => usePreferences().hidden;

export { HIDDEN_VALUES_SHORTCUT };
