import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Filtrar → campo → valor, como a `FilterBar` de Investimentos a conduz. */
export const chooseFilter = async (field: string, value: string): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: /^Filtrar/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: new RegExp(field) }));
  const list = await screen.findByRole('group', { name: field });
  await userEvent.click(within(list).getByRole('checkbox', { name: new RegExp(value) }));
  await userEvent.keyboard('{Escape}');
};

/** Exibição → coluna: mostra ou esconde. */
export const toggleDisplayColumn = async (label: string): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: 'Exibição' }));
  await userEvent.click(await screen.findByRole('button', { name: label }));
  await userEvent.keyboard('{Escape}');
};

/** Agrupar: Dia → opção. */
export const chooseGrouping = async (name: string): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: /^Agrupar:/ }));
  await userEvent.click(
    await screen.findByRole('menuitem', { name: new RegExp(`^${name}`) }),
  );
};
