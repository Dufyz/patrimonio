/**
 * Falha de regra de negócio do motor. O código é estável (`ENTRY_SPLIT_MISMATCH`)
 * e a mensagem é em português; `application` a traduz para o erro HTTP.
 */
export type FinRuleError = {
  readonly code: string;
  readonly message: string;
  /** O campo do corpo a que a falha se refere, quando há um. */
  readonly field?: string;
  /** Dados que a tela usa para explicar (`missing`: quanto falta fechar a divisão). */
  readonly details?: Readonly<Record<string, string>>;
  /** O status HTTP que a regra pede; 422 é o padrão das regras de negócio. */
  readonly status?: 404 | 409 | 422;
};

export const rule = (
  code: string,
  message: string,
  extra: Omit<FinRuleError, 'code' | 'message'> = {},
): FinRuleError => ({ code, message, ...extra });
