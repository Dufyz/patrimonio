import { isCategoryColor } from '../lib/category_colors.js';
import { normalizeText } from '../lib/text.js';
import type { Category, EntryKind, FinanceData } from './types.js';

/**
 * FIN-102 · Criar, editar e excluir categoria.
 *
 * RN-60: nome, tipo e cor, com o nome único dentro do tipo. RN-61: excluir uma
 * categoria em uso exige escolher a que recebe os lançamentos. As funções são
 * puras — recebem os dados e devolvem os dados novos — para a store só gravar.
 */

export type CategoryDraft = {
  readonly name: string;
  readonly kind: EntryKind;
  readonly color: string;
};

export type CategoryErrors = { readonly name?: string; readonly color?: string };

export const NAME_REQUIRED = 'Dê um nome à categoria.';
export const NAME_TAKEN = 'Já existe uma categoria com esse nome neste tipo.';

export const validateCategory = (
  data: FinanceData,
  draft: CategoryDraft,
  editingId?: string,
): CategoryErrors => {
  const name = draft.name.trim();
  if (name === '') return { name: NAME_REQUIRED };
  const taken = data.categories.some(
    (category) =>
      category.id !== editingId &&
      category.kind === draft.kind &&
      normalizeText(category.name) === normalizeText(name),
  );
  if (taken) return { name: NAME_TAKEN };
  if (!isCategoryColor(draft.color)) return { color: 'Escolha uma cor da paleta.' };
  return {};
};

/** Quantos lançamentos usam a categoria, de qualquer situação e período. */
export const categoryReferences = (data: FinanceData, id: string): number =>
  data.entries.filter((entry) => entry.categoryId === id).length;

/** Mudar o tipo só é permitido para categoria sem lançamentos. */
export const canChangeKind = (data: FinanceData, id: string): boolean =>
  categoryReferences(data, id) === 0;

const slug = (name: string): string =>
  normalizeText(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const uniqueId = (data: FinanceData, name: string, kind: EntryKind): string => {
  const base = slug(name) || 'categoria';
  const ids = new Set(data.categories.map((category) => category.id));
  const first = ids.has(base) ? `${base}-${kind}` : base;
  let candidate = first;
  for (let n = 2; ids.has(candidate); n += 1) candidate = `${first}-${n}`;
  return candidate;
};

export const addCategory = (data: FinanceData, draft: CategoryDraft): FinanceData => {
  if (Object.keys(validateCategory(data, draft)).length > 0) return data;
  const category: Category = {
    id: uniqueId(data, draft.name, draft.kind),
    name: draft.name.trim(),
    kind: draft.kind,
    color: draft.color,
  };
  return { ...data, categories: [...data.categories, category] };
};

export const updateCategory = (
  data: FinanceData,
  id: string,
  draft: CategoryDraft,
): FinanceData => {
  const current = data.categories.find((category) => category.id === id);
  if (current === undefined) return data;
  if (Object.keys(validateCategory(data, draft, id)).length > 0) return data;
  const kind = canChangeKind(data, id) ? draft.kind : current.kind;
  return {
    ...data,
    categories: data.categories.map((category) =>
      category.id === id
        ? { ...category, name: draft.name.trim(), kind, color: draft.color }
        : category,
    ),
  };
};

/** As categorias que podem receber os lançamentos de `id`: mesmo tipo, outra categoria. */
export const replacementOptions = (
  data: FinanceData,
  id: string,
): readonly Category[] => {
  const current = data.categories.find((category) => category.id === id);
  if (current === undefined) return [];
  return data.categories.filter(
    (category) => category.id !== id && category.kind === current.kind,
  );
};

export const deleteCategory = (
  data: FinanceData,
  id: string,
  replacementId: string | null,
): FinanceData => {
  const inUse = categoryReferences(data, id) > 0;
  if (inUse) {
    const allowed = replacementOptions(data, id).some((c) => c.id === replacementId);
    if (!allowed || replacementId === null) return data;
  }
  return {
    ...data,
    categories: data.categories.filter((category) => category.id !== id),
    entries:
      replacementId === null
        ? data.entries
        : data.entries.map((entry) =>
            entry.categoryId === id ? { ...entry, categoryId: replacementId } : entry,
          ),
  };
};
