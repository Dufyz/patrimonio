import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

  it('texto sem correspondência oferece criar, com o país', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'z', name: 'Interactive Brokers' });
    const { campo, onChange } = montar({ create });

    await userEvent.type(campo, 'Interactive Brokers');
    await userEvent.click(screen.getByRole('button', { name: 'Criar “Interactive Brokers”' }));
    await userEvent.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('z'));
    expect(create).toHaveBeenCalledWith({ name: 'Interactive Brokers', country: 'US' });
  });

  it('país que não tem duas letras não chega à api', async () => {
    const create = vi.fn();
    const { campo } = montar({ create });

    await userEvent.type(campo, 'Outro Banco');
    await userEvent.click(screen.getByRole('button', { name: 'Criar “Outro Banco”' }));
    const pais = screen.getByLabelText('País da instituição');
    await userEvent.clear(pais);
    await userEvent.type(pais, 'U');
    await userEvent.click(screen.getByRole('button', { name: 'Criar' }));

    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('duas letras');
  });

  it('nome que já existe não oferece criar', async () => {
    const { campo } = montar();

    await userEvent.type(campo, 'btg pactual');

    expect(screen.queryByRole('button', { name: /Criar “/ })).toBeNull();
  });

  it('digitar depois de escolher desfaz a escolha', async () => {
    const { campo, onChange } = montar({ value: 'a' });

    await userEvent.type(campo, 'x');

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
