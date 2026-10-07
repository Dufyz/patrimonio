import type { DateOnly } from '../support/date_only.js';

/**
 * Desdobramento, grupamento e bonificação. Evento corporativo não se aplica
 * sozinho de propósito: um desdobramento aplicado automaticamente com data
 * errada reescreve preço médio e resultado de todo o histórico, e desfazer é
 * mais caro do que um clique de confirmação.
 */
export const CORPORATE_EVENT_KINDS = ['split', 'reverse_split', 'bonus'] as const;

export type CorporateEventKind = (typeof CORPORATE_EVENT_KINDS)[number];

export const isCorporateEventKind = (value: unknown): value is CorporateEventKind =>
  typeof value === 'string' &&
  (CORPORATE_EVENT_KINDS as readonly string[]).includes(value);

export type CorporateEvent = {
  readonly id: string;
  readonly asset_id: string;
  readonly kind: CorporateEventKind;
  /** Data-com: a posição dessa data é a que muda. */
  readonly record_date: DateOnly;
  /** Desdobramento 1:2 grava 1 aqui e 2 em `ratio_to`. */
  readonly ratio_from: string;
  readonly ratio_to: string;
  /** Nulo até a confirmação; o ajuste só acontece depois. */
  readonly confirmed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

/** O texto que o alerta mostra: "desdobramento 1:2", "grupamento 10:1". */
export const describeCorporateEvent = (event: {
  readonly kind: CorporateEventKind;
  readonly ratio_from: string;
  readonly ratio_to: string;
}): string => {
  const ratio = `${Number(event.ratio_from)}:${Number(event.ratio_to)}`;

  switch (event.kind) {
    case 'split':
      return `desdobramento ${ratio}`;
    case 'reverse_split':
      return `grupamento ${ratio}`;
    case 'bonus':
      return `bonificação ${ratio}`;
  }
};
