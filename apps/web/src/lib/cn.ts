import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Junta classes e resolve conflito entre elas — a `cn` que os componentes do
 * shadcn esperam. Os tamanhos de texto customizados (`text-cell`, `text-label`…)
 * são declarados aqui para o merge não os confundir com cor de texto.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['screen-title', 'panel-title', 'cell', 'label', 'principal'] },
      ],
    },
  },
});

export const cn = (...inputs: ClassValue[]): string => merge(clsx(inputs));
