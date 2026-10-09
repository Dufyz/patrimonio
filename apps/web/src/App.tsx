import { ShortcutProvider } from './components/shortcuts.js';
import { Gallery } from './views/gallery.js';

/**
 * A casca da Fase 1.
 *
 * Até E5 o que havia aqui era o cartão de saúde da `api`, que provava o
 * contrato compartilhado de ponta a ponta. Agora o que a aplicação abre é a
 * galeria do design system: é o critério de saída deste épico e o lugar contra
 * o qual as pranchas são conferidas. As telas de verdade chegam em E6 e tomam
 * este lugar.
 */
export const App = (): React.ReactElement => (
  <ShortcutProvider>
    <Gallery />
  </ShortcutProvider>
);
