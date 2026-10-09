import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import { ShortcutProvider } from '../components/shortcuts.js';
import { Gallery } from './gallery.js';

/**
 * E5 · Critério de saída.
 *
 * A galeria monta todas as peças do design system de uma vez, com dado das
 * pranchas. O que este teste cobre não é cada componente — cada um tem o seu —
 * mas as regras que só aparecem quando eles convivem: o tema troca sem
 * recarregar, os valores somem em toda a tela de uma vez e os percentuais
 * ficam, e o atalho funciona de qualquer lugar.
 */
const gallery = () =>
  render(
    <PreferencesProvider storage={null}>
      <ShortcutProvider>
        <Gallery />
      </ShortcutProvider>
    </PreferencesProvider>,
  );

describe('galeria do design system', () => {
  it('monta todas as peças de uma vez', () => {
    gallery();

    expect(screen.getByRole('heading', { name: 'Design system' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Posições abertas hoje' })).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'Retorno acumulado contra benchmarks' }),
    ).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'Proventos recebidos por mês' }),
    ).toBeVisible();
    expect(screen.getByRole('img', { name: 'Composição por classe' })).toBeVisible();
    expect(screen.getByRole('radiogroup', { name: 'Período' })).toBeVisible();
  });

  it('trocar de tema troca o documento sem recarregar nem deslocar nada', async () => {
    const user = userEvent.setup();
    gallery();

    const root = globalThis.document.documentElement;
    const before = screen.getAllByText(/487\.320,55/u)[0]?.textContent;

    await user.click(screen.getByRole('radio', { name: 'Escuro' }));
    expect(root.dataset['theme']).toBe('dark');

    await user.click(screen.getByRole('radio', { name: 'Claro' }));
    expect(root.dataset['theme']).toBe('light');

    // O conteúdo é o mesmo: o tema troca cor, não layout nem número.
    expect(screen.getAllByText(/487\.320,55/u)[0]?.textContent).toBe(before);
  });

  it('a densidade troca a altura da linha, e só isso', async () => {
    const user = userEvent.setup();
    gallery();

    await user.click(screen.getByRole('radio', { name: 'Compacta' }));
    expect(globalThis.document.documentElement.dataset['density']).toBe('compact');
    expect(screen.getByRole('table', { name: 'Posições abertas hoje' })).toBeVisible();
  });

  it('o atalho H esconde os reais da tela inteira e deixa os percentuais', async () => {
    const user = userEvent.setup();
    gallery();

    expect(screen.getAllByText(/487\.320,55/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText('35,3%').length).toBeGreaterThan(0);

    await user.keyboard('h');

    expect(screen.queryAllByText(/487\.320,55/u)).toEqual([]);
    expect(screen.queryByText(/18\.420,00/u)).not.toBeInTheDocument();
    expect(screen.getAllByText('35,3%').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('valor oculto').length).toBeGreaterThan(0);
  });

  it('a ajuda de atalhos abre de qualquer lugar e lista os atalhos', async () => {
    const user = userEvent.setup();
    gallery();

    await user.keyboard('?');
    const help = screen.getByRole('dialog', { name: 'Atalhos de teclado' });

    expect(within(help).getByText('Novo lançamento')).toBeVisible();
    expect(within(help).getByText('G P')).toBeVisible();
  });

  it('a sequência G P navega sem o mouse', async () => {
    const user = userEvent.setup();
    gallery();

    await user.keyboard('gv');
    expect(screen.getByRole('button', { name: /Visão geral/u })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('nenhuma cor literal sobrou em um componente', async () => {
    const { container } = gallery();

    const literal = Array.from(container.querySelectorAll<HTMLElement>('[style]')).filter(
      (node) => /#[0-9a-f]{3}/iu.test(node.getAttribute('style') ?? ''),
    );

    expect(literal).toEqual([]);
  });
});
