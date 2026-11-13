import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressRing } from './progress_ring.js';

describe('anel de progresso do objetivo (CMP-10)', () => {
  it('mostra o percentual no centro, a situação em texto e a marca do ritmo', () => {
    render(<ProgressRing status="behind" progressPct="13.7" expectedPct="23.5" />);

    expect(screen.getByText('13,7%')).toBeVisible();
    expect(screen.getByText('Abaixo do ritmo')).toBeVisible();
    expect(screen.getByText('esperado hoje 23,5%')).toBeVisible();
    expect(screen.getByTestId('ring-mark')).toBeInTheDocument();
  });

  it('a descrição acessível diz o percentual, a situação e o esperado', () => {
    render(<ProgressRing status="on_track" progressPct="40" expectedPct="35" />);

    expect(screen.getByRole('img')).toHaveAccessibleName(
      '40.0% atingido. No ritmo. Esperado hoje: 35.0%.',
    );
  });

  it('sem ponto de partida não há marca nem texto de esperado', () => {
    render(<ProgressRing status="on_track" progressPct="10" expectedPct={null} />);

    expect(screen.queryByTestId('ring-mark')).not.toBeInTheDocument();
    expect(screen.queryByText(/esperado hoje/)).not.toBeInTheDocument();
  });

  it('limita o percentual a 0–100', () => {
    render(<ProgressRing status="reached" progressPct="140" expectedPct="-5" />);

    expect(screen.getByText('100,0%')).toBeVisible();
  });
});
