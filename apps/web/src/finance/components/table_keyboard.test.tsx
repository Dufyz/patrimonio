import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FinTable, Row, Td } from './fin_table.js';

const setup = () => {
  const calls = { open: vi.fn(), toggle: vi.fn(), clear: vi.fn() };
  render(
    <FinTable caption="Teste">
      <tbody>
        <Row
          label="Primeira"
          onToggle={calls.toggle}
          onActivate={calls.open}
          onEscape={calls.clear}
        >
          <Td>Primeira</Td>
        </Row>
        <Row
          label="Segunda"
          onToggle={calls.toggle}
          onActivate={calls.open}
          onEscape={calls.clear}
        >
          <Td>Segunda</Td>
        </Row>
        <Row label="Terceira" onClick={calls.open}>
          <Td>Terceira</Td>
        </Row>
      </tbody>
    </FinTable>,
  );
  return calls;
};

describe('tabela pelo teclado (FIN-705)', () => {
  it('setas andam entre as linhas, inclusive as que abrem por clique', async () => {
    setup();
    screen.getByRole('row', { name: 'Primeira' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('row', { name: 'Segunda' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('row', { name: 'Terceira' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('row', { name: 'Terceira' }));
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('row', { name: 'Primeira' }));
  });

  it('Enter abre, Espaço seleciona e Esc limpa a seleção', async () => {
    const calls = setup();
    screen.getByRole('row', { name: 'Primeira' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(calls.open).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(' ');
    expect(calls.toggle).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(calls.clear).toHaveBeenCalledTimes(1);
  });

  it('linha sem ação não entra na ordem do teclado', () => {
    render(
      <FinTable caption="Teste">
        <tbody>
          <Row label="Muda">
            <Td>Muda</Td>
          </Row>
        </tbody>
      </FinTable>,
    );
    expect(screen.getByRole('row', { name: 'Muda' }).getAttribute('tabindex')).toBeNull();
  });
});
