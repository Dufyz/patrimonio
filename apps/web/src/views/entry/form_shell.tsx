import { useRequestClose } from '../../components/overlay.js';
import { Button } from '../../components/primitives.js';
import { Callout } from './fields.js';
import { submitKeys } from './hooks.js';

/**
 * T-10 · A moldura de todo formulário de lançamento: os atalhos e o rodapé.
 *
 * ⌘↵ salva, ⇧↵ salva e abre outro, Esc fecha e descarta (quem fecha é o modal).
 * O rodapé é o mesmo em todos os modais — Cancelar e a ação principal à direita,
 * a ação destrutiva, quando existe, à esquerda e em vermelho, longe do botão que
 * a pessoa tem o hábito de apertar.
 */
export const FormShell = ({
  onSave,
  onSaveAgain,
  onCancel,
  saveLabel = 'Salvar',
  saveShortcut = '⌘↵',
  showCancel = true,
  pending,
  canSave = true,
  error,
  destructive,
  secondary,
  summary,
  children,
}: {
  readonly onSave: () => void;
  /** Só os formulários que fazem sentido em série (compra, venda) o oferecem. */
  readonly onSaveAgain?: (() => void) | undefined;
  readonly onCancel: () => void;
  readonly saveLabel?: string;
  /** `null` tira a tecla do botão — o "Próximo" de um passo que não grava. */
  readonly saveShortcut?: string | null;
  /** Falso nos passos de um assistente: quem volta é o `secondary`. */
  readonly showCancel?: boolean;
  readonly pending: boolean;
  /** Falso quando não há o que salvar — uma edição sem nenhuma mudança. */
  readonly canSave?: boolean;
  /** O que a `api` recusou e não tem campo próprio. */
  readonly error?: string | null | undefined;
  readonly destructive?: React.ReactNode;
  readonly secondary?: React.ReactNode;
  /** O resumo à esquerda dos campos, no segundo passo do assistente. */
  readonly summary?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const cancel = useRequestClose(onCancel);

  return (
    <form
      noValidate
      // `contents`: o formulário não gera caixa, e o rodapé gruda no fundo do corpo
      // rolável do modal em vez de ficar preso ao fim do formulário. O `bottom`
      // negativo cancela o respiro (`py-5`) do corpo: `sticky` respeita o
      // padding do contêiner de rolagem e, com `bottom-0`, pararia 18 px acima.
      className="contents"
      onSubmit={(event) => event.preventDefault()}
      onKeyDown={submitKeys(onSave, onSaveAgain)}
    >
      {summary === undefined ? (
        children
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-[13rem_minmax(0,1fr)]">
          <div className="self-start">{summary}</div>
          <div className="flex min-w-0 flex-col gap-4">{children}</div>
        </div>
      )}

      {error === null || error === undefined ? null : (
        <Callout tone="error">{error}</Callout>
      )}

      <div className="sticky -bottom-5 z-10 -mx-6 -mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel px-6 py-4">
        <div className="flex items-center gap-2">
          {destructive}
          {secondary}
        </div>
        <div className="flex items-center gap-2">
          {onSaveAgain === undefined ? null : (
            <Button disabled={pending || !canSave} shortcut="⇧↵" onClick={onSaveAgain}>
              Salvar e novo
            </Button>
          )}
          {showCancel ? <Button onClick={cancel}>Cancelar</Button> : null}
          <Button
            variant="primary"
            {...(saveShortcut === null ? {} : { shortcut: saveShortcut })}
            disabled={pending || !canSave}
            onClick={onSave}
          >
            {pending ? 'Salvando…' : saveLabel}
          </Button>
        </div>
      </div>
    </form>
  );
};
