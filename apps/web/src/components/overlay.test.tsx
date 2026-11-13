import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Modal } from './overlay.js';
import { Button } from './primitives.js';

const form = (tone?: 'danger') => {
  const save = vi.fn();
  render(
    <Modal
      open
      title="Editar carteira"
      onClose={() => {}}
      {...(tone === undefined ? {} : { tone })}
      footer={
        <>
          <Button>Cancelar</Button>
          <Button variant="primary" onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      <input aria-label="Nome" />
    </Modal>,
  );
  return save;
};

describe('CFG-07 · ⌘↵ salva o formulário', () => {
  it('Ctrl+↵ no campo aciona o botão principal', async () => {
    const save = form();
    await userEvent.type(
      screen.getByLabelText('Nome'),
      'Longo{Control>}{Enter}{/Control}',
    );

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('Enter sem modificador não salva', async () => {
    const save = form();
    await userEvent.type(screen.getByLabelText('Nome'), 'Longo{Enter}');

    expect(save).not.toHaveBeenCalled();
  });

  it('modal destrutivo não confirma por atalho', async () => {
    const save = form('danger');
    await userEvent.type(screen.getByLabelText('Nome'), '{Control>}{Enter}{/Control}');

    expect(save).not.toHaveBeenCalled();
  });
});
