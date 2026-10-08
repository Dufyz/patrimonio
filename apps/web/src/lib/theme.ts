import type { Storageish } from './preferences.js';
import { readEnum, writeRaw } from './preferences.js';

/**
 * D-01 · Tema e densidade.
 *
 * A preferência tem três valores, mas o documento só conhece dois: `system` é
 * resolvido aqui e nunca chega ao `data-theme`. É o que deixa o CSS com um
 * único bloco por tema — e é o que permite trocar de tema sem recarregar, já
 * que trocar o atributo troca as variáveis e nada mais.
 */

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export const RESOLVED_THEMES = ['light', 'dark'] as const;
export const DENSITIES = ['comfortable', 'compact'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];
export type Density = (typeof DENSITIES)[number];

export const THEME_KEY = 'patrimonio.theme';
export const DENSITY_KEY = 'patrimonio.density';

export const resolveTheme = (
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme => {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
};

export const readThemePreference = (storage: Storageish | null): ThemePreference =>
  readEnum(storage, THEME_KEY, THEME_PREFERENCES, 'system');

export const writeThemePreference = (
  storage: Storageish | null,
  preference: ThemePreference,
): void => writeRaw(storage, THEME_KEY, preference);

export const readDensity = (storage: Storageish | null): Density =>
  readEnum(storage, DENSITY_KEY, DENSITIES, 'comfortable');

export const writeDensity = (storage: Storageish | null, density: Density): void =>
  writeRaw(storage, DENSITY_KEY, density);

/**
 * O script que roda antes da primeira pintura, embutido no `index.html`. Ele
 * existe para evitar o lampejo claro ao abrir no escuro — e é por isso que está
 * aqui como string: o teste compara o que o documento executa com o que esta
 * função decide, e os dois não podem divergir em silêncio.
 */
export const applyThemeToDocument = (
  root: { readonly dataset: DOMStringMap },
  theme: ResolvedTheme,
  density: Density,
): void => {
  root.dataset['theme'] = theme;
  root.dataset['density'] = density;
};
