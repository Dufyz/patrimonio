import type { CategoryResource } from '@patrimonio/contracts';
import { useMemo, useState } from 'react';

import {
  createCategory,
  deleteCategory,
  fetchCategories,
  updateCategory,
} from '../api/registers.js';
import { Modal } from '../components/overlay.js';
import { Button, IconButton } from '../components/primitives.js';
import { CLASS_COLOR_TOKENS, colorForToken } from '../lib/tokens.js';
import { useResource } from '../lib/use_resource.js';
import { Input, Select } from './entry/fields.js';

/**
 * As classes da estratégia: os blocos em que a pessoa pensa o patrimônio ("ações",
 * "FIIs", "renda fixa"). A classe é de primeiro nível e guarda categorias; o alvo
 * da Estratégia é dado a ela, e tudo que está dentro conta para o alvo.
 *
 * Mover uma categoria de classe não mexe nos ativos nem nos alvos: o id da
 * categoria é o mesmo, só muda quem a contém.
 */

type ClassGroup = {
  readonly head: CategoryResource;
  readonly members: readonly CategoryResource[];
};

export const groupClasses = (
  categories: readonly CategoryResource[],
): readonly ClassGroup[] => {
  const byOrder = (left: CategoryResource, right: CategoryResource): number =>
    left.sort_order - right.sort_order || left.name.localeCompare(right.name, 'pt-BR');

  return categories
    .filter((category) => category.parent_id === null)
    .sort(byOrder)
    .map((head) => ({
      head,
      members: categories
        .filter((category) => category.parent_id === head.id)
        .sort(byOrder),
    }));
};

const ColorPicker = ({
  value,
  label,
  onPick,
}: {
  readonly value: string;
  readonly label: string;
  readonly onPick: (token: string) => void;
}): React.ReactElement => (
  <span role="group" aria-label={label} className="flex items-center gap-1">
    {CLASS_COLOR_TOKENS.map((token) => (
      <button
        key={token}
        type="button"
        aria-label={token.replace('class.', '')}
        aria-pressed={value === token}
        onClick={() => {
          if (value !== token) onPick(token);
        }}
        className={`size-4 cursor-pointer rounded-xs ${
          value === token ? 'ring-2 ring-ink ring-offset-1 ring-offset-panel' : ''
        }`}
        style={{ backgroundColor: colorForToken(token) }}
      />
    ))}
  </span>
);

const ClassName = ({
  category,
  onRename,
}: {
  readonly category: CategoryResource;
  readonly onRename: (name: string) => void;
}): React.ReactElement => {
  const [text, setText] = useState(category.name);

  const commit = (): void => {
    const trimmed = text.trim();
    if (trimmed === '') setText(category.name);
    else if (trimmed !== category.name) onRename(trimmed);
  };

  return (
    <Input
      invalid={false}
      aria-label={`Nome da classe ${category.name}`}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') setText(category.name);
      }}
    />
  );
};

export const ClassesDialog = ({
  onClose,
  onChanged,
}: {
  readonly onClose: () => void;
  /** Avisa quem abriu que as classes mudaram, para a Estratégia reler. */
  readonly onChanged: () => void;
}): React.ReactElement => {
  const resource = useResource((signal) => fetchCategories(signal), []);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');

  const categories = resource.state.kind === 'ready' ? resource.state.value : [];
  const classes = useMemo(() => groupClasses(categories), [categories]);
  const options = classes.map((group) => ({ id: group.head.id, name: group.head.name }));

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await action();
      resource.reload();
      onChanged();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível salvar');
      // A relida devolve a tela ao que está salvo, e não ao que ficou digitado.
      resource.reload();
    } finally {
      setBusy(false);
    }
  };

  const create = (): void => {
    const name = newName.trim();
    if (name === '') return;
    void run(async () => {
      await createCategory({ name, color_token: 'class.outros' });
      setNewName('');
    });
  };

  return (
    <Modal
      open
      title="Classes"
      subtitle="Agrupe as categorias nas classes em que você pensa a estratégia"
      onClose={onClose}
      footer={
        <>
          <span role="alert" className="text-[0.8125rem] text-negative">
            {failure}
          </span>
          <Button variant="primary" onClick={onClose}>
            Concluir
          </Button>
        </>
      }
    >
      <p className="mb-4 text-[0.8125rem] text-ink-2">
        O alvo da Estratégia é dado à classe, e tudo que está dentro dela conta para esse
        alvo. Mover uma categoria de classe não altera ativos nem alvos salvos.
      </p>

      {resource.state.kind === 'loading' ? (
        <p className="text-[0.8125rem] text-ink-3">Carregando…</p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {classes.map((group) => (
          <li key={group.head.id} className="rounded-panel border border-line">
            <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel-2 px-3 py-2">
              <span className="min-w-40 flex-1">
                <ClassName
                  category={group.head}
                  onRename={(name) =>
                    void run(() => updateCategory(group.head.id, { name }))
                  }
                />
              </span>
              <ColorPicker
                value={group.head.color_token}
                label={`Cor de ${group.head.name}`}
                onPick={(token) =>
                  void run(() => updateCategory(group.head.id, { color_token: token }))
                }
              />
              <IconButton
                icon="trash"
                label={`Excluir a classe ${group.head.name}`}
                disabled={busy || group.members.length > 0}
                title={
                  group.members.length > 0
                    ? 'Mova as categorias para outra classe antes de excluir'
                    : undefined
                }
                onClick={() => void run(() => deleteCategory(group.head.id))}
              />
            </div>

            {group.members.length === 0 ? (
              <p className="px-3 py-2 text-[0.8125rem] text-ink-3">
                Classe vazia. Mova categorias para cá pelo seletor de outra classe.
              </p>
            ) : (
              <ul>
                {group.members.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5 last:border-b-0"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-[0.8125rem]">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-xs"
                        style={{ backgroundColor: colorForToken(member.color_token) }}
                      />
                      <span className="truncate">{member.name}</span>
                    </span>
                    <span className="w-48 shrink-0">
                      <Select
                        invalid={false}
                        aria-label={`Classe de ${member.name}`}
                        value={group.head.id}
                        options={options}
                        disabled={busy}
                        onChange={(event) =>
                          void run(() =>
                            updateCategory(member.id, { parent_id: event.target.value }),
                          )
                        }
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <Input
            invalid={false}
            aria-label="Nome da nova classe"
            placeholder="Nova classe, como Cripto"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create();
            }}
          />
        </span>
        <Button disabled={busy || newName.trim() === ''} onClick={create}>
          Criar classe
        </Button>
      </div>
    </Modal>
  );
};
