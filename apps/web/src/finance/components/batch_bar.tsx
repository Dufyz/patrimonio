import { Button, IconButton } from '../../components/primitives.js';
import { pluralize } from '../lib/header.js';

/** FIN-309 · A barra de seleção em lote: contagem e ações sobre as linhas marcadas. */
export const BatchBar = ({
  count,
  onRecategorize,
  onMove,
  onDelete,
  onClear,
}: {
  readonly count: number;
  readonly onRecategorize: () => void;
  readonly onMove: () => void;
  readonly onDelete: () => void;
  readonly onClear: () => void;
}): React.ReactElement => (
  <div
    role="toolbar"
    aria-label="Seleção em lote"
    className="flex flex-wrap items-center gap-2 border-t border-line bg-accent-soft px-4 py-2"
  >
    <span className="tabular text-[0.8125rem] font-medium">
      {pluralize(count, 'selecionado', 'selecionados')}
    </span>
    <span className="ml-auto flex items-center gap-2">
      <Button onClick={onRecategorize}>Recategorizar</Button>
      <Button onClick={onMove}>Mover de conta</Button>
      <Button variant="danger" onClick={onDelete}>
        Excluir
      </Button>
      <IconButton label="Limpar seleção" icon="close" onClick={onClear} />
    </span>
  </div>
);
