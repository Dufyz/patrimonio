import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { Amount } from './amount.js';
import {
  CategoryMarker,
  FinTable,
  Row,
  SectionRow,
  SummaryRow,
  Td,
  Th,
  THead,
} from './fin_table.js';
import { LimitBar } from './limit_bar.js';
import { StatStrip } from './stat_strip.js';
import { NatureTag, StatusTag } from './tags.js';

const wrap = (node: React.ReactNode, hidden = false) => {
  if (hidden) globalThis.localStorage.setItem('patrimonio.hidden_values', 'true');
  return render(<PreferencesProvider>{node}</PreferencesProvider>);
};

describe('valores', () => {
  it('despesa com − e receita com +, verde só na receita', () => {
    wrap(
      <>
        <p data-testid="d">
          <Amount cents={-450000} variant="flow" />
        </p>
        <p data-testid="r">
          <Amount cents={35000} variant="flow" />
        </p>
      </>,
    );
    expect(screen.getByTestId('d')).toHaveTextContent('−R$ 4.500,00');
    expect(screen.getByTestId('r')).toHaveTextContent('+R$ 350,00');
    expect(screen.getByTestId('r').firstElementChild).toHaveClass('text-positive');
    expect(screen.getByTestId('d').firstElementChild).not.toHaveClass('text-negative');
  });

  it('variação verde quando sobe e vermelha quando desce', () => {
    wrap(
      <>
        <p data-testid="up">
          <Amount cents={157360} variant="delta" />
        </p>
        <p data-testid="down">
          <Amount cents={-5000} variant="delta" />
        </p>
      </>,
    );
    expect(screen.getByTestId('up').firstElementChild).toHaveClass('text-positive');
    expect(screen.getByTestId('down').firstElementChild).toHaveClass('text-negative');
  });

  it('o botão de ocultar valores mascara o valor', () => {
    wrap(<Amount cents={1177315} />, true);
    expect(screen.getByLabelText('valor oculto')).toBeVisible();
    expect(screen.queryByText(/11\.773/)).toBeNull();
  });
});

describe('tabela', () => {
  it('linha clicável tem mão, muda no mouse e abre com Enter', async () => {
    const onClick = vi.fn();
    render(
      <FinTable caption="Contas">
        <THead>
          <Th>Conta</Th>
          <Th align="right">Saldo</Th>
        </THead>
        <tbody>
          <SectionRow colSpan={2} label="Contas" summary="entram no saldo em contas" />
          <Row onClick={onClick} label="Itaú Corrente">
            <Td>Itaú Corrente</Td>
            <Td numeric>R$ 3.112,80</Td>
          </Row>
          <SummaryRow kind="total">
            <Td>Total em contas</Td>
            <Td numeric>R$ 11.773,15</Td>
          </SummaryRow>
        </tbody>
      </FinTable>,
    );

    const row = screen.getByRole('row', { name: 'Itaú Corrente' });
    expect(row).toHaveClass('cursor-pointer', 'hover:bg-panel-2');
    await userEvent.click(row);
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);

    expect(screen.getByRole('columnheader', { name: 'Conta' })).toHaveAttribute(
      'scope',
      'col',
    );
    expect(screen.getByText('entram no saldo em contas')).toBeVisible();
    expect(document.querySelector('[data-summary="total"]')).not.toBeNull();
  });

  it('marcador de categoria: quadrado colorido e o nome', () => {
    render(<CategoryMarker color="var(--color-cat-moradia)" name="Moradia" />);
    expect(screen.getByText('Moradia')).toBeVisible();
    expect(screen.getByTestId('category-swatch')).toHaveStyle({
      backgroundColor: 'var(--color-cat-moradia)',
    });
  });
});

describe('etiquetas', () => {
  it('situação com ponto e texto', () => {
    render(<StatusTag status="fechada" />);
    expect(screen.getByText('fechada')).toBeVisible();
    expect(document.querySelector('[data-status="fechada"]')).toHaveClass('bg-attention');
  });

  it('previsto tem contorno tracejado; recorrente, contínuo', () => {
    render(
      <>
        <NatureTag kind="previsto" />
        <NatureTag kind="recorrente" />
        <NatureTag kind="parcela">parcela 3/6</NatureTag>
      </>,
    );
    expect(document.querySelector('[data-nature="previsto"]')).toHaveClass(
      'border-dashed',
    );
    expect(document.querySelector('[data-nature="recorrente"]')).not.toHaveClass(
      'border-dashed',
    );
    expect(screen.getByText('parcela 3/6')).toBeVisible();
  });
});

describe('faixa de indicadores e barra de limite', () => {
  it('cada célula tem rótulo, valor e legenda', () => {
    render(
      <StatStrip
        label="Totais"
        cells={[
          { id: 'r', label: 'Receitas', value: 'R$ 16.350,00', caption: '3 lançamentos' },
          { id: 'd', label: 'Despesas', value: 'R$ 9.478,10', caption: '9 lançamentos' },
        ]}
      />,
    );
    expect(screen.getByText('Receitas')).toBeVisible();
    expect(screen.getByText('R$ 9.478,10')).toBeVisible();
    expect(screen.getByText('3 lançamentos')).toBeVisible();
  });

  it('barra de limite com percentual ao lado e cor por faixa', () => {
    render(<LimitBar percent={70.4} />);
    expect(screen.getByText('70,4%')).toBeVisible();
    expect(document.querySelector('[data-tone="warn"]')).not.toBeNull();
  });
});
