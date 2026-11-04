import type { DateOnly } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * A leitura da tela de Objetivos, em **uma** consulta.
 *
 * Tudo o que a projeção precisa do objetivo — o valor da carteira que o mede
 * hoje e no começo, o fluxo mensal dos últimos meses — e o IPCA dos
 * últimos doze meses saem sobre a mesma data de referência. Uma consulta com
 * CTEs devolve o objetivo já agregado, e o banco fica em outra rede: cada
 * leitura a mais aparece na abertura da tela.
 *
 * O que o banco **não** faz é projetar: juros compostos, aporte necessário e
 * data de chegada são de `packages/calc`, e o repositório entrega só o que é
 * fato — valores fechados e fluxos.
 */
/** O que o usuário escreve num objetivo. */
export type GoalWrite = {
  readonly name: string;
  readonly target_amount: string;
  readonly target_date: DateOnly;
  readonly return_assumption: string | null;
  readonly amount_in_today_brl: boolean;
};

export type GoalSaved = GoalWrite & {
  readonly id: string;
  /** Falso quando o objetivo já existia e foi editado. */
  readonly created: boolean;
};

export type GoalSnapshotQuery = {
  readonly portfolio_id: string;
  readonly on_date: DateOnly;
  /**
   * Um objetivo ainda não gravado, medido como se fosse o da carteira: é a
   * prévia do modal. Ele parte de quando o objetivo gravado foi criado, ou de
   * `on_date` se a carteira ainda não tem um.
   */
  readonly draft?: GoalWrite | undefined;
};

/** O fluxo líquido da carteira do objetivo num mês, `YYYY-MM`. */
export type GoalFlowRow = {
  readonly month: string;
  readonly net_flow: string;
};

export type GoalRow = {
  readonly goal_id: string;
  readonly name: string;
  readonly target_amount: string;
  readonly target_date: DateOnly;
  readonly return_assumption: string | null;
  readonly amount_in_today_brl: boolean;
  readonly created_on: DateOnly;
  /** O último fechamento da carteira até a data. Zero sem fechamento. */
  readonly current_value: string;
  /** A data desse fechamento. */
  readonly as_of: DateOnly | null;
  /** O primeiro fechamento da carteira: de onde existe história. */
  readonly history_start: DateOnly | null;
  /**
   * De onde a trajetória necessária parte: o dia em que o objetivo foi criado,
   * ou o primeiro fechamento, se a história começou depois dele.
   */
  readonly start_date: DateOnly | null;
  /** O valor da carteira em `start_date`. */
  readonly start_value: string | null;
  /** Os meses recentes com fluxo. Mês sem fluxo não aparece. */
  readonly flows: readonly GoalFlowRow[];
};

export type GoalInflationRow = {
  /** O produto dos fatores diários do IPCA nos últimos doze meses. */
  readonly factor: string | null;
  readonly first_date: DateOnly | null;
  readonly last_date: DateOnly | null;
};

export type GoalSnapshot = {
  /** A carteira dos objetivos. Nulo quando ela não existe ou está arquivada. */
  readonly scope_portfolio: {
    readonly portfolio_id: string;
    readonly name: string;
  } | null;
  /** O objetivo aberto da carteira. Nulo quando ela ainda não tem um. */
  readonly goal: GoalRow | null;
  readonly inflation: GoalInflationRow;
};

/** O objetivo aberto de cada carteira ativa, lido numa consulta só. */
export type GoalOverviewQuery = {
  readonly on_date: DateOnly;
};

export type GoalOverviewRow = {
  readonly portfolio_id: string;
  readonly portfolio_name: string;
  /** Nulo quando a carteira ainda não tem objetivo. */
  readonly goal: GoalRow | null;
};

export type GoalOverviewSnapshot = {
  /** Todas as carteiras ativas, na ordem em que o usuário as organizou. */
  readonly portfolios: readonly GoalOverviewRow[];
  readonly inflation: GoalInflationRow;
};

export type GoalRepository = {
  readonly snapshot: (
    query: GoalSnapshotQuery,
  ) => Promise<Either<AppError, GoalSnapshot>>;

  /** Os objetivos de todas as carteiras ativas, sobre a mesma data de referência. */
  readonly overview: (
    query: GoalOverviewQuery,
  ) => Promise<Either<AppError, GoalOverviewSnapshot>>;

  /**
   * Cria o objetivo aberto da carteira, ou edita o que já existe: o índice
   * único parcial decide, na mesma instrução, e duas gravações simultâneas não
   * produzem dois objetivos.
   */
  readonly save: (
    portfolio_id: string,
    write: GoalWrite,
  ) => Promise<Either<AppError, GoalSaved>>;

  /** Falso quando a carteira não tinha objetivo aberto. */
  readonly remove: (portfolio_id: string) => Promise<Either<AppError, boolean>>;
};
