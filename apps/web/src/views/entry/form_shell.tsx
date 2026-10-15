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
  pending,
  canSave = true,
  error,
  destructive,
  secondary,
  children,
}: {
  readonly onSave: () => void;
  /** Só os formulários que fazem sentido em série (compra, venda) o oferecem. */
  readonly onSaveAgain?: (() => void) | undefined;
  readonly onCancel: () => void;
  readonly saveLabel?: string;
  readonly pending: boolean;
  /** Falso quando não há o que salvar — uma edição sem nenhuma mudança. */
  readonly canSave?: boolean;
  /** O que a `api` recusou e não tem campo próprio. */
  readonly error?: string | null | undefined;
  readonly destructive?: React.ReactNode;
  readonly secondary?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const cancel = useRequestClose(onCancel);

  return (
    <form
      noValidate
      // `contents`: o formulário não gera caixa, e o rodapé gruda no fundo do corpo
      // rolável do modal em vez de ficar preso ao fim do formulário. O `bottom`
      // negativo cancela o respiro (`py-[18px]`) do corpo: `sticky` respeita o
      // padding do contêiner de rolagem e, com `bottom-0`, pararia 18 px acima.
      className="contents"
      onSubmit={(event) => event.preventDefault()}
      onKeyDown={submitKeys(onSave, onSaveAgain)}
    >
      {children}

      {error === null || error === undefined ? null : (
        <Callout tone="error">{error}</Callout>
      )}

      <div className="sticky -bottom-[18px] z-10 -mx-5 -mb-[18px] flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel-2 px-5 py-3.5">
        <div className="flex items-center gap-2">
          {destructive}
          {onSaveAgain === undefined ? null : (
            <Button disabled={pending || !canSave} shortcut="⇧↵" onClick={onSaveAgain}>
              Salvar e novo
            </Button>
          )}
          {secondary}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={cancel}>Cancelar</Button>
          <Button
            variant="primary"
            shortcut="⌘↵"
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
