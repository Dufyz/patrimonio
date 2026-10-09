import { describe, expect, it } from 'vitest';

// O arquivo de verdade, lido pelo mesmo bundler que o serve.
import html from '../../index.html?raw';
import type { Density, ThemePreference } from './theme.js';
import { readDensity, readThemePreference, resolveTheme } from './theme.js';

/**
 * O script embutido no `index.html` roda antes do React e decide o tema sozinho.
 * Se ele e `lib/theme.ts` discordarem, a tela pisca na recarga — um defeito que
 * nenhum teste de componente pega, porque acontece antes de haver componente.
 *
 * Este teste executa o script de verdade, com um documento falso, e compara a
 * decisão dele com a do módulo para toda combinação de preferência e sistema.
 */
const bootScript = (): string => {
  const match = /<script>([\s\S]*?)<\/script>/u.exec(html);
  if (match?.[1] === undefined) throw new Error('index.html perdeu o script de tema');
  return match[1];
};

const runBoot = (
  stored: Record<string, string>,
  prefersDark: boolean,
): { theme: string | undefined; density: string | undefined } => {
  const dataset: Record<string, string> = {};
  const scope = {
    document: { documentElement: { dataset } },
    localStorage: { getItem: (key: string) => stored[key] ?? null },
    matchMedia: () => ({ matches: prefersDark }),
  };

  const run = new Function('document', 'localStorage', 'matchMedia', bootScript()) as (
    ...args: unknown[]
  ) => void;

  run(scope.document, scope.localStorage, scope.matchMedia);
  return { theme: dataset['theme'], density: dataset['density'] };
};

const storageOf = (stored: Record<string, string>) => ({
  getItem: (key: string) => stored[key] ?? null,
  setItem: () => {},
  removeItem: () => {},
});

describe('script de tema do index.html', () => {
  const preferences: readonly (ThemePreference | 'sepia')[] = [
    'light',
    'dark',
    'system',
    'sepia',
  ];
  const densities: readonly (Density | 'gigante')[] = [
    'comfortable',
    'compact',
    'gigante',
  ];

  it('decide o mesmo tema que lib/theme.ts em toda combinação', () => {
    for (const preference of preferences) {
      for (const prefersDark of [true, false]) {
        const stored = { 'patrimonio.theme': preference };
        expect(runBoot(stored, prefersDark).theme).toBe(
          resolveTheme(readThemePreference(storageOf(stored)), prefersDark),
        );
      }
    }
  });

  it('decide a mesma densidade que lib/theme.ts', () => {
    for (const density of densities) {
      const stored = { 'patrimonio.density': density };
      expect(runBoot(stored, false).density).toBe(readDensity(storageOf(stored)));
    }
  });

  it('sem nada guardado, abre claro e confortável seguindo o sistema', () => {
    expect(runBoot({}, false)).toEqual({ theme: 'light', density: 'comfortable' });
    expect(runBoot({}, true).theme).toBe('dark');
  });
});
