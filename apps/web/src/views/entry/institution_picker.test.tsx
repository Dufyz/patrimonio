import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ControlProps } from './fields.js';
import { InstitutionPicker } from './institution_picker.js';

const CONTROL: ControlProps = {
  id: 'instituicao',
  'aria-describedby': undefined,
  'aria-invalid': false,
};

const OPTIONS = [
  { id: 'a', name: 'BANCO INTER S.A.' },
  { id: 'b', name: 'XP INVESTIMENTOS' },
  { id: 'c', name: 'BTG PACTUAL' },
];

afterEach(cleanup);

const montar = (overrides: Partial<React.ComponentProps<typeof InstitutionPicker>> = {}) => {
  const onChange = vi.fn();
  render(
    <InstitutionPicker
      options={OPTIONS}
      value={null}
      onChange={onChange}
      control={CONTROL}
      invalid={false}
      {...overrides}
    />,
  );
  return { onChange, campo: screen.getByRole('combobox') };
};

describe('o seletor de instituição', () => {
  it('filtra o catálogo sem diferenciar caixa nem acento', async () => {
    const { campo } = montar();

    await userEvent.type(campo, 'inter');

    const lista = screen.getByRole('listbox');
    expect(lista.textContent).toContain('BANCO INTER S.A.');
    expect(lista.textContent).not.toContain('XP');
  });

  it('escolher uma instituição entrega o id e põe o nome no campo', async () => {
    const { campo, onChange } = montar();

    await userEvent.type(campo, 'xp');
    await userEvent.click(screen.getByRole('option', { name: 'XP INVESTIMENTOS' }));

    expect(onChange).toHaveBeenCalledWith('b');
    expect((campo as HTMLInputElement).value).toBe('XP INVESTIMENTOS');
  });

  it('texto sem correspondência diz que nada foi encontrado e não oferece criar', async () => {
    const { campo } = montar();

    await userEvent.type(campo, 'Interactive Brokers');

    expect(screen.getByRole('listbox').textContent).toContain('Nenhuma instituição encontrada');
    expect(screen.queryByRole('button', { name: /Criar/ })).toBeNull();
  });

  it('digitar depois de escolher desfaz a escolha', async () => {
    const { campo, onChange } = montar({ value: 'a' });

    await userEvent.type(campo, 'x');

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
