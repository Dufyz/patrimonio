import { Button } from './primitives.js';

/**
 * CMP-08 · Os estados de tela e de painel, uma só vez.
 *
 * Erro nunca vira "nenhum resultado": uma tela vazia porque a `api` caiu é a pior
 * mentira que uma tela financeira conta. Todo erro traz a causa, quando a
 * `api` a deu, e "Tentar novamente"; todo vazio traz o que fazer. Carregando é
 * o `Skeleton` (components/skeleton), com a forma do que vai chegar.
 */

/** A tela inteira que não carregou. */
export const ScreenFailed = ({
  error,
  onRetry,
  title = 'A tela não pôde ser carregada',
}: {
  readonly error: Error;
  readonly onRetry: () => void;
  readonly title?: string;
}): React.ReactElement => (
  <section
    role="alert"
    className="rounded-panel border border-line bg-panel p-8 text-center"
  >
    <h2 className="text-panel-title font-semibold text-negative">{title}</h2>
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      {error.message}
    </p>
    <button
      type="button"
      className="mt-4 h-control cursor-pointer rounded-control border border-line px-3 text-[0.8125rem] hover:bg-panel-2"
      onClick={onRetry}
    >
      Tentar novamente
    </button>
  </section>
);

/** Um painel que falhou: a falha não derruba os outros nem a tela. */
export const PanelFailed = ({
  error,
  onRetry,
  what,
}: {
  readonly error: Error;
  readonly onRetry: () => void;
  /** O que não carregou: "os lotes", "a situação das fontes". */
  readonly what: string;
}): React.ReactElement => (
  <div role="alert" className="flex flex-wrap items-center gap-3 p-4 text-[0.8125rem]">
    <span className="text-negative">
      Não foi possível ler {what}: {error.message}
    </span>
    <Button onClick={onRetry}>Tentar novamente</Button>
  </div>
);

/** Um painel sem dado: mensagem curta e a ação principal; filtro sem resultado limpa o filtro. */
export const PanelEmpty = ({
  message,
  action,
  onClearFilters,
}: {
  readonly message: string;
  readonly action?: React.ReactNode;
  /** Com filtro aplicado e nenhum resultado, oferece "Limpar filtros". */
  readonly onClearFilters?: (() => void) | undefined;
}): React.ReactElement => (
  <div className="flex flex-wrap items-center gap-3 p-4 text-[0.8125rem] text-ink-3">
    <span>{message}</span>
    {onClearFilters === undefined ? null : (
      <Button onClick={onClearFilters}>Limpar filtros</Button>
    )}
    {action}
  </div>
);
