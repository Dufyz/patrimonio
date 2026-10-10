import type { AllocationResource, PutStrategyBody } from '@patrimonio/contracts';

import { parseDecimal } from './decimal.js';

/**
 * T-06 · As decisões da tela de Estratégia.
 *
 * Quase tudo que a tela mostra chega calculado da `api` — desvio, valor a mover,
 * valor no alvo. A exceção é o que ainda não foi salvo: enquanto o usuário
 * digita, a soma dos alvos só existe no navegador, e é ela que trava o botão de
 * salvar. Essa soma é feita em **centésimos de ponto percentual**, em inteiros —
 * a coluna do banco é `numeric(6,2)`, então duas casas são tudo o que existe —,
 * e nunca em `number` fracionário: `35,1 + 24,9` em ponto flutuante não é
 * garantidamente `60`, e é exatamente o número que decide se dá para salvar.
 *
 * Nenhum valor em reais é calculado aqui. Enquanto há edição, as colunas de
 * desvio e de valor continuam sendo as da estratégia salva — a tela diz isso —,
 * em vez de recalcular dinheiro no navegador.
 */

type Node = AllocationResource['composition']['nodes'][number];

/** O ativo sem categoria entra no total, mas não há categoria onde dar alvo. */
export const NO_CATEGORY_ID = 'sem-categoria';

/** Centésimos de ponto percentual: `35,25%` é `3525`, e `100%` é `10000`. */
export type Hundredths = number;

export const WHOLE: Hundredths = 10_000;

/* -------------------------------------------------------------------------- */
/* Texto ⇄ centésimos                                                          */

const TYPED = /^(\d{1,3})(?:[.,](\d{0,2}))?$/;

/**
 * O que o usuário digitou, em centésimos. Vazio é zero — campo apagado é
 * "esta categoria não tem alvo" — e o que não é número entre 0 e 100 com até
 * duas casas é `null`, que o campo mostra como erro em vez de adivinhar.
 */
export const toHundredths = (text: string): Hundredths | null => {
  const trimmed = text.trim().replace(/%$/, '').trim();
  if (trimmed === '') return 0;

  const match = TYPED.exec(trimmed);
  if (match === null) return null;

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const value = whole * 100 + fraction;

  return value > WHOLE ? null : value;
};

/** `"35.00"` da `api` em centésimos. Ausente é zero: alvo zero e sem alvo salvam igual. */
export const fromPercent = (value: string | null | undefined): Hundredths => {
  if (value === null || value === undefined) return 0;

  const parts = parseDecimal(value);
  if (parts === null) return 0;

  return Number(parts.integer) * 100 + Number(parts.fraction.slice(0, 2).padEnd(2, '0'));
};

/** O corpo da `api`: `"35.00"`, com ponto e sempre duas casas. */
export const toPercentString = (value: Hundredths): string =>
  `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;

/** Como o campo mostra: `35`, `12,5`, `12,25` — vírgula do pt-BR, sem zero à toa. */
export const inputText = (value: Hundredths): string => {
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');

  return fraction === '' ? String(whole) : `${whole},${fraction}`;
};

/** O alvo como rótulo: `60%`, `12,5%`. */
export const targetLabel = (value: Hundredths): string => `${inputText(value)}%`;

/* -------------------------------------------------------------------------- */
/* As linhas editáveis                                                         */

export type EditableRow = {
  readonly id: string;
  readonly name: string;
  readonly colorToken: string;
  readonly saved: Hundredths;
  /** O grupo em que a categoria está, ou nulo na raiz. */
  readonly groupId: string | null;
};

/**
 * Quem recebe alvo: toda categoria — as de dentro dos grupos e as soltas na
 * raiz, como Caixa. O grupo não: ele é a soma das categorias, e um alvo próprio
 * seria um número que pode divergir das partes.
 */
export const editableRows = (nodes: readonly Node[]): readonly EditableRow[] =>
  nodes.flatMap((node): readonly EditableRow[] => {
    if (node.level === 'group') {
      return node.children
        .filter((child) => child.id !== NO_CATEGORY_ID)
        .map((child) => ({
          id: child.id,
          name: child.name,
          colorToken: child.color_token,
          saved: fromPercent(child.target_pct),
          groupId: node.id,
        }));
    }

    if (node.id === NO_CATEGORY_ID) return [];

    return [
      {
        id: node.id,
        name: node.name,
        colorToken: node.color_token,
        saved: fromPercent(node.target_pct),
        groupId: null,
      },
    ];
  });

/** O que o usuário mexeu: id da categoria → o texto que está no campo. */
export type Draft = Readonly<Record<string, string>>;

export const EMPTY_DRAFT: Draft = {};

export const valueText = (row: EditableRow, draft: Draft): string =>
  draft[row.id] ?? inputText(row.saved);

const parsed = (row: EditableRow, draft: Draft): Hundredths | null =>
  row.id in draft ? toHundredths(draft[row.id] ?? '') : row.saved;

/** O erro do campo, dito no próprio campo. Nulo é campo válido. */
export const fieldError = (text: string): string | null =>
  toHundredths(text) === null ? 'Use um número de 0 a 100, com até duas casas' : null;

/** Digitar o valor que já estava salvo desfaz a alteração em vez de contá-la. */
export const withEdit = (
  rows: readonly EditableRow[],
  draft: Draft,
  id: string,
  text: string,
): Draft => {
  const row = rows.find((candidate) => candidate.id === id);
  if (row === undefined) return draft;

  if (toHundredths(text) === row.saved) {
    return Object.fromEntries(Object.entries(draft).filter(([key]) => key !== id));
  }

  return { ...draft, [id]: text };
};

/* -------------------------------------------------------------------------- */
/* A soma e a barra de salvar                                                  */

export type SaveState = {
  /** Quantos campos diferem do que está salvo. */
  readonly changed: number;
  readonly invalid: readonly string[];
  /** A soma dos alvos digitados; nula se algum campo é inválido. */
  readonly total: Hundredths | null;
  readonly canSave: boolean;
  readonly message: string;
  /** A soma não fecha: a barra fica vermelha e aponta a diferença. */
  readonly blocked: boolean;
};

const points = (value: Hundredths): string => inputText(Math.abs(value));

export const saveState = (rows: readonly EditableRow[], draft: Draft): SaveState => {
  const invalid = rows.filter((row) => parsed(row, draft) === null).map((row) => row.id);

  // Um campo só conta como alteração se o número difere do salvo: depois de
  // salvar, o rascunho continua igual ao que acabou de virar o salvo, e a barra
  // some sem ninguém ter de limpá-lo.
  const changed = rows.filter(
    (row) => row.id in draft && parsed(row, draft) !== row.saved,
  ).length;

  if (invalid.length > 0) {
    return {
      changed,
      invalid,
      total: null,
      canSave: false,
      blocked: true,
      message:
        invalid.length === 1
          ? 'Corrija 1 campo para salvar'
          : `Corrija ${invalid.length} campos para salvar`,
    };
  }

  const total = rows.reduce((sum, row) => sum + (parsed(row, draft) ?? 0), 0);

  // Zero em tudo é "sem estratégia definida", que o banco aceita. Qualquer outra
  // soma que não feche 100% é recusada antes de ir, com o que falta dito.
  if (changed > 0 && total !== 0 && total !== WHOLE) {
    const missing = WHOLE - total;

    return {
      changed,
      invalid,
      total,
      canSave: false,
      blocked: true,
      message: `Soma ${targetLabel(total)} · ${missing > 0 ? 'faltam' : 'passou'} ${points(missing)} pp para salvar`,
    };
  }

  return {
    changed,
    invalid,
    total,
    canSave: changed > 0,
    blocked: false,
    message:
      changed === 0
        ? ''
        : total === 0
          ? 'Todos os alvos em zero: salvar remove a estratégia'
          : changed === 1
            ? '1 alteração não salva'
            : `${changed} alterações não salvas`,
  };
};

/** O subtotal de um grupo com o que está digitado: o grupo é a soma das categorias. */
export const groupTotal = (
  rows: readonly EditableRow[],
  draft: Draft,
  groupId: string,
): Hundredths | null => {
  let total = 0;

  for (const row of rows.filter((candidate) => candidate.groupId === groupId)) {
    const value = parsed(row, draft);
    if (value === null) return null;
    total += value;
  }

  return total;
};

/**
 * O corpo do `PUT`. Alvo zero não vai: o banco exige acima de zero, e "sem linha"
 * é como ele guarda "esta categoria não tem alvo".
 */
export const buildBody = (
  rows: readonly EditableRow[],
  draft: Draft,
): PutStrategyBody => ({
  targets: rows.flatMap((row) => {
    const value = parsed(row, draft) ?? 0;
    return value === 0
      ? []
      : [{ category_id: row.id, target_pct: toPercentString(value) }];
  }),
});

/* -------------------------------------------------------------------------- */
/* Geometria das barras                                                        */

/**
 * O fundo da barra é o maior valor da tabela arredondado para cima de dez em
 * dez: com Ações em 35,3% a barra cheia é 40%, e o desvio de um ponto é visível.
 * Uma barra fixa em 100% deixaria toda linha menor que 25% como um traço.
 *
 * É pixel, não dinheiro, e por isso é a única conta com `number` aqui.
 */
export const barScale = (nodes: readonly Node[]): number => {
  const values = nodes.flatMap((node) =>
    (node.level === 'group' ? node.children : [node]).flatMap((line) => [
      Number(line.current_pct),
      Number(line.target_pct ?? 0),
    ]),
  );
  const largest = Math.max(0, ...values.filter(Number.isFinite));

  return Math.max(10, Math.ceil(largest / 10) * 10);
};

/** Posição em percentual do fundo da barra, presa a 0–100. */
export const barPosition = (value: string | null, scale: number): number => {
  const number = Number(value);
  if (!Number.isFinite(number) || scale <= 0) return 0;

  return Math.max(0, Math.min(100, (number / scale) * 100));
};

/** A faixa de tolerância em volta do alvo, em posição da barra. */
export const toleranceBand = (
  target: string | null,
  tolerance: string,
  scale: number,
): { readonly left: number; readonly width: number } | null => {
  if (target === null) return null;

  const center = Number(target);
  const radius = Number(tolerance);
  if (!Number.isFinite(center) || !Number.isFinite(radius) || radius <= 0) return null;

  const left = barPosition(String(center - radius), scale);
  const right = barPosition(String(center + radius), scale);

  return { left, width: right - left };
};

/* -------------------------------------------------------------------------- */
/* Valor do aporte                                                             */

/**
 * O que o usuário digitou como valor do aporte, no formato da `api`. Aceita
 * `4000`, `4000,50`, `4.000,50` e `4000.50`; o ponto é milhar quando vem em
 * grupos de três e decimal quando vem com uma ou duas casas. Zero, negativo e
 * texto são `null`: aporte que não compra nada não tem o que sugerir.
 */
export const parseAmount = (text: string): string | null => {
  const trimmed = text.trim().replace(/^R\$\s*/, '');
  if (trimmed === '') return null;

  let normalized: string;

  if (trimmed.includes(',')) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    normalized = trimmed.replace(/\./g, '');
  } else {
    normalized = trimmed;
  }

  if (!/^\d{1,15}(\.\d{1,2})?$/.test(normalized)) return null;
  if (/^0+(\.0+)?$/.test(normalized)) return null;

  return normalized;
};

/** `"0.00"`, `"-0.00"` e `"0"`: zero não tem direção, e não leva `+` nem cor. */
export const isZeroDecimal = (value: string | null): boolean =>
  value !== null && /^[+-]?0+(\.0+)?$/.test(value.trim());
