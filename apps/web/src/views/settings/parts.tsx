import { IconButton, Panel } from '../../components/primitives.js';
import type { Tone } from '../../lib/settings.js';

/**
 * As peças que as nove seções de Configurações repetem. Elas ficam ao lado da
 * tela porque só ela as usa: o que dois ou mais lugares precisam vai para
 * `components/`, e este não é o caso.
 */

/** Cada seção é um painel com âncora, para a navegação lateral levar até ela. */
export const SettingsSection = ({
  id,
  title,
  description,
  action,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly description: React.ReactNode;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <div id={`secao-${id}`} className="scroll-mt-4">
    <Panel title={title} {...(action === undefined ? {} : { action })}>
      <p className="border-b border-line px-4 py-3 text-[0.8125rem] text-ink-2">
        {description}
      </p>
      {children}
    </Panel>
  </div>
);

const DOT_CLASS: Readonly<Record<Tone, string>> = {
  ok: 'bg-positive',
  attention: 'bg-attention',
  error: 'bg-negative',
  neutral: 'bg-ink-3',
};

const TONE_TEXT: Readonly<Record<Tone, string>> = {
  ok: 'text-ink-2',
  attention: 'text-attention',
  error: 'text-negative',
  neutral: 'text-ink-2',
};

/** Ponto + palavra: a cor sozinha não diz a situação a quem não a distingue. */
export const StatusDot = ({
  tone,
  children,
}: {
  readonly tone: Tone;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <span className={`inline-flex items-center gap-2 ${TONE_TEXT[tone]}`}>
    <span aria-hidden="true" className={`size-2 rounded-full ${DOT_CLASS[tone]}`} />
    {children}
  </span>
);

/**
 * O interruptor. Com `onChange` ele age; sem, ele é leitura — mostra o estado
 * que a `api` guarda e não promete um clique que não grava nada.
 */
export const Switch = ({
  checked,
  label,
  onChange,
  title,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange?: ((checked: boolean) => void) | undefined;
  readonly title?: string | undefined;
}): React.ReactElement => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={onChange === undefined}
    {...(title === undefined ? {} : { title })}
    className={`inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
      checked ? 'bg-accent' : 'bg-panel-2'
    }`}
    onClick={() => onChange?.(!checked)}
  >
    <span
      aria-hidden="true"
      className={`size-3.5 rounded-full bg-panel shadow-sm transition-transform ${
        checked ? 'translate-x-4' : ''
      }`}
    />
  </button>
);

/** O lápis de editar. Vale T-10: a edição acontece em modal, e o modal é dela. */
export const EditButton = ({ label }: { readonly label: string }): React.ReactElement => (
  <IconButton label={`Editar ${label} chega com T-10`} disabled>
    <span aria-hidden="true">✎</span>
  </IconButton>
);

export const TH =
  'px-4 py-2 text-left text-label font-medium tracking-wide whitespace-nowrap text-ink-3 uppercase';
export const TH_RIGHT = `${TH} text-right`;
export const TD = 'px-4';
export const ROW = 'h-(--row-height) border-t border-line';

/** Texto secundário de uma célula: o que prende a exclusão, uma nota. */
export const Muted = ({
  children,
  title,
}: {
  readonly children: React.ReactNode;
  readonly title?: string | undefined;
}): React.ReactElement => (
  <span className="text-ink-3" {...(title === undefined ? {} : { title })}>
    {children}
  </span>
);

/** O resultado de uma ação da tela, dito onde o botão está. */
export const ActionNote = ({
  tone,
  children,
}: {
  readonly tone: Tone;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <p role="status" className={`text-[0.8125rem] ${TONE_TEXT[tone]}`}>
    {children}
  </p>
);
