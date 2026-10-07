import {
  BadRequestError,
  ConflictError,
  DatabaseError,
  isAppError,
} from '@patrimonio/application';
import type { AppError } from '@patrimonio/application';

/** Os códigos do Postgres que viram erro de cliente. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const INVALID_TEXT_REPRESENTATION = '22P02';
/**
 * Mesma família dos dois acima — o dado que subiu não satisfaz uma regra
 * declarada — e por isso 400, não 500. É o que faz uma estratégia somando 96%
 * voltar como erro de cliente em vez de erro de banco.
 */
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';

type DriverError = {
  code?: string;
  constraint_name?: string;
  table_name?: string;
  column_name?: string;
  message?: string;
};

const asDriverError = (error: unknown): DriverError =>
  typeof error === 'object' && error !== null ? (error as DriverError) : {};

/**
 * Descreve a violação pelo nome da restrição e da tabela, nunca pelo `detail`
 * do driver: o `detail` carrega os valores da linha, e valor monetário,
 * quantidade e nome de ativo não entram no log.
 */
const describe = (driver: DriverError): string => {
  const parts = [driver.constraint_name, driver.table_name, driver.column_name].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );

  return parts.length > 0 ? parts.join(' em ') : 'restrição do banco';
};

/**
 * Traduz o erro do driver para a hierarquia de `application`. Nenhuma camada
 * acima de `db` vê exceção do Postgres.
 */
export const getRepositoryError = (error: unknown): AppError => {
  // Um `AppError` que já veio de dentro do trabalho atravessa intacto.
  if (isAppError(error)) return error;

  const driver = asDriverError(error);

  switch (driver.code) {
    case UNIQUE_VIOLATION:
      return new ConflictError(`Registro já existe: ${describe(driver)}`);

    case FOREIGN_KEY_VIOLATION:
      return new BadRequestError(`Referência inexistente: ${describe(driver)}`);

    case INVALID_TEXT_REPRESENTATION:
      return new BadRequestError(`Valor fora do domínio aceito: ${describe(driver)}`);

    case CHECK_VIOLATION:
      return new BadRequestError(`Regra do banco não satisfeita: ${describe(driver)}`);

    case NOT_NULL_VIOLATION:
      return new BadRequestError(`Campo obrigatório ausente: ${describe(driver)}`);

    default:
      return new DatabaseError(
        driver.code === undefined
          ? 'Falha ao falar com o banco'
          : `Falha no banco (${driver.code})`,
      );
  }
};
