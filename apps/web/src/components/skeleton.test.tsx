import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ScreenSkeleton, SkeletonRegion, SkeletonTable } from './skeleton.js';

describe('skeleton', () => {
  it('marca a região como ocupada e diz o que carrega, para quem não vê a forma', () => {
    render(
      <SkeletonRegion label="Carregando a visão geral">
        <SkeletonTable />
      </SkeletonRegion>,
    );

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Carregando a visão geral')).toBeInTheDocument();
  });

  it('não carrega número nenhum: um valor de mentira seria lido como saldo', () => {
    render(<ScreenSkeleton label="Carregando as posições" />);

    expect(screen.getByRole('status').textContent).toBe('Carregando as posições');
  });

  it('a tabela tem as linhas e colunas pedidas', () => {
    const { container } = render(<SkeletonTable rows={3} columns={4} />);

    // Cabeçalho mais três linhas, cada uma com quatro barras.
    expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(4 * 4);
  });
});
