import { Icon } from '../../components/icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { MODAL_KIND_LABEL, MODAL_KINDS } from '../../lib/ledger_entry_form.js';
import type { ModalKind } from '../../lib/ledger_entry_form.js';
import { KIND_LABEL, LedgerKindTag } from './ledger_parts.js';

/**
 * O campo "Tipo" do modal de lançamento (prancha 07): a pastilha colorida do
 * tipo dentro de um seletor, igual à etiqueta das linhas da lista.
 */
export const KindSelect = ({
  value,
  onChange,
  id,
  kinds = MODAL_KINDS,
}: {
  readonly value: ModalKind;
  readonly onChange: (kind: ModalKind) => void;
  readonly id?: string | undefined;
  /** Os tipos que o campo oferece; o recorrente só tem três. */
  readonly kinds?: readonly ModalKind[];
}): React.ReactElement => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        id={id}
        aria-label={`Tipo: ${MODAL_KIND_LABEL[value]}`}
        className="flex h-[38px] w-full cursor-pointer items-center justify-between gap-2 rounded-control border border-line-2 bg-field px-2.5 text-left outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
      >
        <LedgerKindTag kind={value} planned={false} />
        <span aria-hidden="true" className="text-ink-2">
          <Icon name="chevron-down" />
        </span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      aria-label="Tipo"
      align="start"
      className="w-(--radix-dropdown-menu-trigger-width)"
    >
      {kinds.map((kind) => (
        <DropdownMenuItem key={kind} onSelect={() => onChange(kind)}>
          <span className="flex items-center gap-2.5">
            <span aria-hidden="true" className="w-3.5 text-accent">
              {kind === value ? <Icon name="check" size={14} /> : null}
            </span>
            <LedgerKindTag kind={kind} planned={false} />
            {MODAL_KIND_LABEL[kind] === KIND_LABEL[kind] ? null : (
              <span className="text-ink-3">{MODAL_KIND_LABEL[kind]}</span>
            )}
          </span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);
