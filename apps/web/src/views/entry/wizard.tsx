import { Button } from '../../components/primitives.js';

/**
 * O que o segundo passo do lançamento recebe do assistente: o resumo do que foi
 * escolhido no primeiro, o caminho de volta e o "salvar e novo", que volta ao
 * primeiro passo em vez de limpar um campo que já não existe.
 */
export type EntryWizard = {
  readonly summary: React.ReactNode;
  readonly onBack: () => void;
  readonly onAgain: () => void;
};

export const BackButton = ({
  onBack,
}: {
  readonly onBack: () => void;
}): React.ReactElement => (
  <Button variant="ghost" onClick={onBack}>
    Voltar
  </Button>
);

/** O quadro cinza à esquerda dos campos: o que se está lançando. */
export const EntrySummary = ({
  items,
}: {
  readonly items: readonly { readonly term: string; readonly value: React.ReactNode }[];
}): React.ReactElement => (
  <dl className="flex flex-col gap-4 rounded-panel bg-panel-2 p-5 text-[0.8125rem]">
    {items.map((item) => (
      <div key={item.term}>
        <dt className="text-xs text-ink-3">{item.term}</dt>
        <dd className="font-semibold">{item.value}</dd>
      </div>
    ))}
  </dl>
);
