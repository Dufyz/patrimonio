import { AppError } from './app-error.js';

export type FinanceErrorItem = {
  readonly code: string;
  readonly message: string;
  readonly field?: string | undefined;
  readonly details?: Readonly<Record<string, string>> | undefined;
};

/**
 * Falha de regra de Finanças. Carrega o `code` estável que a tela usa para
 * decidir o que mostrar, e todas as falhas da mesma tentativa em `errors`, para
 * o formulário marcar vários campos de uma vez.
 */
export class FinanceError extends AppError {
  readonly code: string;
  readonly field: string | undefined;
  readonly details: Readonly<Record<string, string>> | undefined;
  readonly errors: readonly FinanceErrorItem[];

  constructor(errors: readonly FinanceErrorItem[], statusCode = 422) {
    const first = errors[0] ?? {
      code: 'FINANCE_RULE',
      message: 'Regra de Finanças violada.',
    };
    super(first.message, statusCode);
    this.code = first.code;
    this.field = first.field;
    this.details = first.details;
    this.errors = errors;
  }

  override toJSON(): ReturnType<AppError['toJSON']> & {
    code: string;
    field?: string | undefined;
    details?: Readonly<Record<string, string>> | undefined;
    errors: readonly FinanceErrorItem[];
  } {
    return {
      ...super.toJSON(),
      code: this.code,
      field: this.field,
      details: this.details,
      errors: this.errors,
    };
  }
}

export const isFinanceError = (value: unknown): value is FinanceError =>
  value instanceof FinanceError;
