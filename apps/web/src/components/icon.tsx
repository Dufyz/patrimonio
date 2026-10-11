import { cn } from '../lib/cn.js';

/**
 * D-02 · O conjunto de ícones das pranchas.
 *
 * Os traçados são os das pranchas, copiados um a um: grade 16 × 16, traço de
 * 1,5, pontas e junções arredondadas, sem preenchimento. Nenhum glifo de texto
 * (▦, ⇄, ⚑…) entra no lugar de um ícone — a fonte decide o desenho do glifo, e é
 * por isso que ele nunca chega perto do que o design define.
 *
 * O ícone herda a cor do texto (`currentColor`): estado ativo, hover e cor
 * semântica são decididos por quem o usa, nunca por ele.
 */

const PATHS = {
  grid: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>
  ),
  list: <path d="M2 4h12 M2 8h12 M2 12h12" />,
  swap: <path d="M3 5h10L10 2 M13 11H3l3 3" />,
  trend: <path d="M2 13l4-5 3 3 5-7" />,
  target: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  flag: <path d="M4 14V2 M4 3h8l-2 3 2 3H4" />,
  // Engrenagem. O traçado nasce numa grade de 24 e é reduzido para a de 16; o
  // `vectorEffect` mantém o traço em 1,5 em vez de encolher junto com o desenho.
  settings: (
    <g transform="scale(0.6667)">
      <path
        vectorEffect="non-scaling-stroke"
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
      />
      <circle vectorEffect="non-scaling-stroke" cx="12" cy="12" r="3" />
    </g>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </>
  ),
  plus: <path d="M8 3v10 M3 8h10" />,
  close: <path d="M4 4l8 8 M12 4l-8 8" />,
  check: <path d="M3 8.5l3 3 7-7" />,
  'chevron-down': <path d="M4 6l4 4 4-4" />,
  'chevron-right': <path d="M6 4l4 4-4 4" />,
  'chevron-left': <path d="M10 4L6 8l4 4" />,
  'arrow-up': <path d="M8 13V3 M4 7l4-4 4 4" />,
  'arrow-down': <path d="M8 3v10 M4 9l4 4 4-4" />,
  'arrow-right': <path d="M2 8h12 M10 4l4 4-4 4" />,
  eye: (
    <>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
      <path d="M2.5 13.5l11-11" />
    </>
  ),
  calendar: (
    <>
      <rect x="2" y="3" width="12" height="11" rx="1" />
      <path d="M2 6.5h12 M5 1.5v3 M11 1.5v3" />
    </>
  ),
  pulse: <path d="M1.5 8h3l2-4 3 8 2-4h3" />,
  dots: (
    <>
      <circle cx="3.5" cy="8" r=".8" />
      <circle cx="8" cy="8" r=".8" />
      <circle cx="12.5" cy="8" r=".8" />
    </>
  ),
  coin: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.5v7" />
    </>
  ),
  warning: <path d="M8 2l6.5 11.5h-13z M8 6.5v3.5 M8 12v.2" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5v4 M8 5v.2" />
    </>
  ),
  tag: (
    <>
      <path d="M2 2h6l6 6-6 6-6-6z" />
      <circle cx="5.5" cy="5.5" r="1" />
    </>
  ),
  archive: (
    <>
      <rect x="2" y="3" width="12" height="3" rx=".5" />
      <path d="M3 6v7.5h10V6 M6.5 9h3" />
    </>
  ),
  /** Exportar: a seta sai da bandeja. Não é `archive` — a caixa fechada quer dizer guardar. */
  export: <path d="M8 10V2 M5 5l3-3 3 3 M2.5 9v4.5h11V9" />,
  pencil: <path d="M10.5 2.5l3 3L6 13H3v-3z" />,
  copy: (
    <>
      <rect x="5" y="5" width="9" height="9" rx="1" />
      <path d="M11 5V2H2v9h3" />
    </>
  ),
  trash: <path d="M2.5 4h11 M6 4V2.5h4V4 M4 4l.7 9.5h6.6L12 4" />,
  undo: <path d="M5 3L2 6l3 3 M2 6h7.5a4 4 0 010 8H6" />,
  briefcase: (
    <>
      <path d="M2 5h12v8.5H2z M5.5 5V3h5v2" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

/**
 * Resolve o nome de ícone que veio de fora — recentes da busca guardados no
 * navegador, por exemplo, que podem ter sido gravados quando o glifo ainda era
 * um caractere de texto. Nome desconhecido cai em `tag`, nunca em tela vazia.
 */
export const iconFor = (name: string): IconName =>
  name in PATHS ? (name as IconName) : 'tag';

export const Icon = ({
  name,
  size = 16,
  className,
}: {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string | undefined;
}): React.ReactElement => (
  <svg
    viewBox="0 0 16 16"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={cn('shrink-0', className)}
  >
    {PATHS[name]}
  </svg>
);

/** A marca da barra lateral: três barras brancas sobre o quadrado de acento. */
export const Logo = (): React.ReactElement => (
  <span
    aria-hidden="true"
    className="flex size-5 items-end gap-0.5 rounded-[5px] bg-accent p-1"
  >
    <span className="h-[5px] w-[3px] bg-accent-ink" />
    <span className="h-2 w-[3px] bg-accent-ink" />
    <span className="h-3 w-[3px] bg-accent-ink" />
  </span>
);
