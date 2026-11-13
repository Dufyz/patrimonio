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

describe('a tabela única de atalhos (NAV-11)', () => {
  it('as letras de G são as da especificação', () => {
    const go = (id: string): string | undefined =>
      SHORTCUTS.find((shortcut) => shortcut.id === id)?.sequence.join(' ');

    expect(go('go_overview')).toBe('g v');
    expect(go('go_entries')).toBe('g l');
    expect(go('go_accounts')).toBe('g c');
    expect(go('go_cards')).toBe('g a');
    expect(go('go_positions')).toBe('g p');
    expect(go('go_strategy')).toBe('g e');
    expect(go('go_goals')).toBe('g o');
    expect(go('go_projection')).toBe('g j');
    expect(go('go_recurrings')).toBe('g r');
    expect(go('go_categories')).toBe('g t');
    expect(go('go_settings')).toBe('g ,');
  });

  it('G seguido de vírgula abre as Configurações', () => {
    const first = resolveShortcut([], press('g'));
    expect(resolveShortcut(first.buffer, press(',')).shortcut?.id).toBe('go_settings');
  });

  it('⌘1, ⌘2 e ⌘3 trocam de carteira', () => {
    for (const n of ['1', '2', '3']) {
      expect(resolveShortcut([], press(n, { metaKey: true })).shortcut?.id).toBe(
        `portfolio_${n}`,
      );
    }
    expect(resolveShortcut([], press('4', { metaKey: true })).shortcut).toBeNull();
  });

  it('⇧↵ salva e abre outro, de dentro de um campo, e não abre a linha', () => {
    const typed = resolveShortcut(
      [],
      press('enter', { shiftKey: true, target: field('input') }),
    );
    expect(typed.shortcut?.id).toBe('form_submit_again');
    expect(resolveShortcut([], press('enter', { shiftKey: true })).shortcut?.id).toBe(
      'form_submit_again',
    );
    expect(resolveShortcut([], press('enter')).shortcut?.id).toBe('row_open');
  });

  it('o selo se escreve como se lê', () => {
    const find = (id: string) => SHORTCUTS.find((shortcut) => shortcut.id === id);
    expect(
      describeShortcut(find('form_submit_again') as (typeof SHORTCUTS)[number]),
    ).toBe('⇧↵');
    expect(describeShortcut(find('portfolio_2') as (typeof SHORTCUTS)[number])).toBe(
      '⌘2',
    );
  });
});
