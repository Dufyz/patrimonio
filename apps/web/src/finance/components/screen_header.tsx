import { useMemo } from 'react';
import { Link } from 'react-router';

import { usePreferences } from '../../components/preferences.js';
import { Button, IconButton } from '../../components/primitives.js';
import { useShortcuts } from '../../components/shortcuts.js';

/**
 * FIN-002 · O cabeçalho padrão de tela.
 *
 * Título e subtítulo à esquerda; à direita, o controle de período (quando a tela
 * tem), o botão de ocultar valores e o botão de novo item com o selo `N`. As
 * telas de detalhe mostram migalhas acima do título, com o primeiro nível
 * clicável. O estado de ocultar valores é o mesmo em todas as telas, porque
 * vive nas preferências do aparelho.
 */

export type Crumb = {
  readonly label: string;
  /** Só o primeiro nível leva a algum lugar. */
  readonly to?: string | undefined;
};

export type PrimaryAction = {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
};

export const ScreenHeader = ({
  title,
  subtitle,
  crumbs,
  period,
  extra,
  primary,
}: {
  readonly title: string;
  readonly subtitle: React.ReactNode;
  readonly crumbs?: readonly Crumb[] | undefined;
  /** O controle de período, nas telas que têm. */
  readonly period?: React.ReactNode;
  /** Botões secundários, como "Transferir" em Contas, antes do principal. */
  readonly extra?: React.ReactNode;
  readonly primary?: PrimaryAction | undefined;
}): React.ReactElement => {
  const { hidden, toggleHidden } = usePreferences();

  const onNew = primary?.onClick;
  const disabled = primary?.disabled === true;
  const shortcuts = useMemo(
    () => (onNew === undefined || disabled ? {} : { new_transaction: onNew }),
    [onNew, disabled],
  );
  useShortcuts(shortcuts);

  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {crumbs === undefined || crumbs.length === 0 ? null : (
          <nav aria-label="Migalhas" className="mb-1 text-xs text-ink-3">
            <ol className="flex items-center gap-1.5">
              {crumbs.map((crumb, index) => (
                <li key={crumb.label} className="flex items-center gap-1.5">
                  {index > 0 ? <span aria-hidden="true">›</span> : null}
                  {crumb.to === undefined ? (
                    <span aria-current={index === crumbs.length - 1 ? 'page' : undefined}>
                      {crumb.label}
                    </span>
                  ) : (
                    <Link to={crumb.to} className="hover:text-ink hover:underline">
                      {crumb.label}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="text-screen-title leading-tight font-semibold tracking-[-0.01em]">
          {title}
        </h1>
        <p className="text-[0.8125rem] text-ink-3">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {period}
        {extra}
        <IconButton
          label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
          icon={hidden ? 'eye-off' : 'eye'}
          aria-pressed={hidden}
          onClick={toggleHidden}
        />
        {primary === undefined ? null : (
          <Button
            variant="primary"
            icon="plus"
            shortcut="N"
            disabled={primary.disabled === true}
            onClick={primary.onClick}
          >
            {primary.label}
          </Button>
        )}
      </div>
    </header>
  );
};
