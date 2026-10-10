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
}): React.ReactElement => (
  <form
    noValidate
    className="flex flex-col gap-4"
    onSubmit={(event) => event.preventDefault()}
    onKeyDown={submitKeys(onSave, onSaveAgain)}
  >
    {children}

    {error === null || error === undefined ? null : (
      <Callout tone="error">{error}</Callout>
    )}

    <div className="-mx-5 -mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
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
        <Button onClick={onCancel}>Cancelar</Button>
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
