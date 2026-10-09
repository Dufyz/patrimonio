/**
 * D-11 · Os atalhos de teclado.
 *
 * A lista mora aqui, em dados, por dois motivos: a tela de ajuda é gerada dela
 * — uma ajuda escrita à mão desatualiza no primeiro atalho novo —, e a decisão
 * de "este evento casa com este atalho" vira função pura, que é a parte em que
 * o erro costuma estar.
 *
 * A navegação usa sequência de duas teclas (`G` e depois `P`) em vez de
 * modificador. `Ctrl+P` e `Cmd+P` já têm dono no navegador, e disputar com o
 * navegador é uma briga que a aplicação perde.
 */

export type ShortcutScope = 'global' | 'navigation' | 'row' | 'form' | 'overlay';

export type Shortcut = {
  readonly id: string;
  /** Sequência de teclas, em minúsculas. Uma só tecla é uma sequência de um. */
  readonly sequence: readonly string[];
  readonly label: string;
  readonly scope: ShortcutScope;
  /** Modificador exigido, para os poucos atalhos que têm um. */
  readonly modifier?: 'meta' | undefined;
};

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'search',
    sequence: ['k'],
    modifier: 'meta',
    label: 'Busca global',
    scope: 'global',
  },
  { id: 'new_transaction', sequence: ['n'], label: 'Novo lançamento', scope: 'global' },
  { id: 'hide_values', sequence: ['h'], label: 'Ocultar valores', scope: 'global' },
  { id: 'help', sequence: ['?'], label: 'Esta ajuda', scope: 'global' },

  { id: 'go_overview', sequence: ['g', 'v'], label: 'Visão geral', scope: 'navigation' },
  { id: 'go_positions', sequence: ['g', 'p'], label: 'Posições', scope: 'navigation' },
  {
    id: 'go_transactions',
    sequence: ['g', 'm'],
    label: 'Movimentações',
    scope: 'navigation',
  },
  {
    id: 'go_performance',
    sequence: ['g', 'd'],
    label: 'Desempenho',
    scope: 'navigation',
  },
  { id: 'go_strategy', sequence: ['g', 'e'], label: 'Estratégia', scope: 'navigation' },
  { id: 'go_goals', sequence: ['g', 'o'], label: 'Objetivos', scope: 'navigation' },

  { id: 'row_transaction', sequence: ['l'], label: 'Lançar na linha', scope: 'row' },
  { id: 'row_edit', sequence: ['e'], label: 'Editar a linha', scope: 'row' },
  { id: 'row_duplicate', sequence: ['d'], label: 'Duplicar a linha', scope: 'row' },
  { id: 'row_open', sequence: ['enter'], label: 'Abrir a linha', scope: 'row' },
  { id: 'row_delete', sequence: ['backspace'], label: 'Excluir a linha', scope: 'row' },

  {
    id: 'form_submit',
    sequence: ['enter'],
    modifier: 'meta',
    label: 'Salvar',
    scope: 'form',
  },
  { id: 'overlay_close', sequence: ['escape'], label: 'Fechar', scope: 'overlay' },
];

export const SCOPE_TITLES: Readonly<Record<ShortcutScope, string>> = {
  global: 'Em qualquer lugar',
  navigation: 'Ir para',
  row: 'Na linha selecionada',
  form: 'No formulário',
  overlay: 'Em menu e modal',
};

/**
 * Campo de texto, área de texto, seletor e qualquer coisa editável. Nenhum
 * atalho de letra dispara aqui — digitar "n" no campo de observação não pode
 * abrir um lançamento novo.
 */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (target === null || !(target instanceof globalThis.HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
};

export type KeyEvent = {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly target: EventTarget | null;
};

const normalize = (key: string): string => key.toLowerCase();

const hasModifier = (event: KeyEvent): boolean => event.metaKey || event.ctrlKey;

/**
 * Qual atalho o evento aciona, dado o que já foi digitado. Devolve também o
 * novo tampão: `g` sozinho não aciona nada, mas abre uma sequência; qualquer
 * outra tecla o descarta.
 */
export const resolveShortcut = (
  buffer: readonly string[],
  event: KeyEvent,
  available: readonly Shortcut[] = SHORTCUTS,
): { readonly shortcut: Shortcut | null; readonly buffer: readonly string[] } => {
  const key = normalize(event.key);

  // Modificador é o único caso em que um atalho dispara dentro de um campo:
  // `⌘Enter` salva o formulário de onde quer que o foco esteja.
  if (isTypingTarget(event.target) && !hasModifier(event)) {
    return { shortcut: null, buffer: [] };
  }

  if (hasModifier(event)) {
    const found = available.find(
      (candidate) =>
        candidate.modifier === 'meta' &&
        candidate.sequence.length === 1 &&
        candidate.sequence[0] === key,
    );
    return { shortcut: found ?? null, buffer: [] };
  }

  if (event.altKey) return { shortcut: null, buffer: [] };

  const next = [...buffer, key];

  const exact = available.find(
    (candidate) =>
      candidate.modifier === undefined &&
      candidate.sequence.length === next.length &&
      candidate.sequence.every((part, index) => part === next[index]),
  );
  if (exact !== undefined) return { shortcut: exact, buffer: [] };

  const isPrefix = available.some(
    (candidate) =>
      candidate.modifier === undefined &&
      candidate.sequence.length > next.length &&
      next.every((part, index) => candidate.sequence[index] === part),
  );

  return { shortcut: null, buffer: isPrefix ? next : [] };
};

/** `['g','p']` → `G P`; `⌘K` quando tem modificador. */
export const describeShortcut = (shortcut: Shortcut): string => {
  const keys = shortcut.sequence.map((key) =>
    key === 'enter'
      ? '↵'
      : key === 'escape'
        ? 'Esc'
        : key === 'backspace'
          ? '⌫'
          : key.toUpperCase(),
  );
  return shortcut.modifier === 'meta' ? `⌘${keys.join(' ')}` : keys.join(' ');
};

export const groupShortcuts = (
  shortcuts: readonly Shortcut[] = SHORTCUTS,
): readonly { readonly scope: ShortcutScope; readonly items: readonly Shortcut[] }[] =>
  (Object.keys(SCOPE_TITLES) as ShortcutScope[])
    .map((scope) => ({
      scope,
      items: shortcuts.filter((shortcut) => shortcut.scope === scope),
    }))
    .filter((group) => group.items.length > 0);
