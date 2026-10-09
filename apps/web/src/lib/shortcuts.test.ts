import { describe, expect, it } from 'vitest';

import type { KeyEvent } from './shortcuts.js';
import {
  SHORTCUTS,
  describeShortcut,
  groupShortcuts,
  isTypingTarget,
  resolveShortcut,
} from './shortcuts.js';

const press = (key: string, overrides: Partial<KeyEvent> = {}): KeyEvent => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target: null,
  ...overrides,
});

const field = (tag: 'input' | 'textarea' | 'select'): HTMLElement =>
  globalThis.document.createElement(tag);

describe('atalhos de teclado', () => {
  it('uma tecla aciona o atalho de ação', () => {
    expect(resolveShortcut([], press('n')).shortcut?.id).toBe('new_transaction');
    expect(resolveShortcut([], press('h')).shortcut?.id).toBe('hide_values');
  });

  it('a navegação pede duas teclas em sequência', () => {
    const first = resolveShortcut([], press('g'));
    expect(first.shortcut).toBeNull();
    expect(first.buffer).toEqual(['g']);

    expect(resolveShortcut(first.buffer, press('p')).shortcut?.id).toBe('go_positions');
  });

  it('uma sequência interrompida não aciona o atalho errado', () => {
    const first = resolveShortcut([], press('g'));
    const stray = resolveShortcut(first.buffer, press('z'));

    expect(stray.shortcut).toBeNull();
    expect(stray.buffer).toEqual([]);
  });

  it('a busca global tem atalho próprio com modificador', () => {
    expect(resolveShortcut([], press('k', { metaKey: true })).shortcut?.id).toBe(
      'search',
    );
    expect(resolveShortcut([], press('k', { ctrlKey: true })).shortcut?.id).toBe(
      'search',
    );
  });

  it('nenhum atalho de letra dispara com o foco em campo de texto', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      expect(resolveShortcut([], press('n', { target: field(tag) })).shortcut).toBeNull();
    }
  });

  it('o atalho de salvar funciona de dentro do formulário', () => {
    expect(
      resolveShortcut([], press('enter', { metaKey: true, target: field('input') }))
        .shortcut?.id,
    ).toBe('form_submit');
  });

  it('digitar em um campo não deixa sequência pendurada', () => {
    expect(resolveShortcut(['g'], press('p', { target: field('input') })).buffer).toEqual(
      [],
    );
  });

  it('texto editável também conta como campo de texto', () => {
    const editable = globalThis.document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom não implementa `isContentEditable` a partir do atributo.
    Object.defineProperty(editable, 'isContentEditable', { value: true });

    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(globalThis.document.createElement('div'))).toBe(false);
  });

  it('a ajuda é gerada da mesma lista que os atalhos usam', () => {
    const groups = groupShortcuts();
    const listed = groups.flatMap((group) => group.items);

    expect(listed).toHaveLength(SHORTCUTS.length);
    expect(groups.map((group) => group.scope)).toContain('navigation');
  });

  it('o atalho é descrito como se lê', () => {
    const navigate = SHORTCUTS.find((shortcut) => shortcut.id === 'go_positions');
    const search = SHORTCUTS.find((shortcut) => shortcut.id === 'search');
    const close = SHORTCUTS.find((shortcut) => shortcut.id === 'overlay_close');

    expect(describeShortcut(navigate as (typeof SHORTCUTS)[number])).toBe('G P');
    expect(describeShortcut(search as (typeof SHORTCUTS)[number])).toBe('⌘K');
    expect(describeShortcut(close as (typeof SHORTCUTS)[number])).toBe('Esc');
  });

  it('nenhum atalho de ação colide com outro no mesmo alcance', () => {
    const seen = new Map<string, string>();
    for (const shortcut of SHORTCUTS) {
      const key = `${shortcut.scope}:${shortcut.modifier ?? ''}:${shortcut.sequence.join('+')}`;
      expect(seen.get(key)).toBeUndefined();
      seen.set(key, shortcut.id);
    }
  });
});
