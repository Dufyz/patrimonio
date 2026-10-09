import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { intensityScale } from '../lib/chart/intensity.js';
import { AllocationBar, CompositionBar, GoalProgressBar } from './bars.js';
import { MonthYearGrid } from './month_year_grid.js';
import { MonthlyBarsChart } from './monthly_bars_chart.js';
import { PreferencesProvider } from './preferences.js';
import { SeriesChart } from './series_chart.js';

const wrap = (node: React.ReactNode) =>
  render(<PreferencesProvider storage={null}>{node}</PreferencesProvider>);

const dates = ['2026-07-31', '2026-08-31', '2026-09-30', '2026-10-06'];

const seriesChart = (props: Partial<React.ComponentProps<typeof SeriesChart>> = {}) =>
  wrap(
    <SeriesChart
      dates={dates}
      series={[
        {
          id: 'carteira',
          label: 'Longo prazo',
          color: 'var(--color-series-1)',
          points: [
            { date: dates[0] as string, value: '0.10' },
            { date: dates[1] as string, value: '0.14' },
            { date: dates[2] as string, value: null },
            { date: dates[3] as string, value: '0.22' },
          ],
        },
        {
          id: 'cdi',
          label: 'CDI',
          color: 'var(--color-series-benchmark)',
          dashed: true,
          points: dates.map((date, index) => ({
            date,
            value: String(0.08 + index / 100),
          })),
        },
      ]}
      valueFormat="percent"
      ariaLabel="Retorno acumulado contra benchmarks"
      xTickLabel={(date) => date.slice(5)}
      tooltipDateLabel={(date) => date}
      width={800}
      {...props}
    />,
  );

describe('gráfico de série', () => {
  it('buraco na série não vira interpolação', () => {
    const { container } = seriesChart();
    const carteira = container.querySelectorAll('path[data-series="carteira"]');
    // Dois traços, porque há um buraco no meio.
    expect(carteira).toHaveLength(2);
  });

  it('o benchmark é tracejado, para não disputar com a carteira', () => {
    const { container } = seriesChart();
    const cdi = container.querySelector('path[data-series="cdi"]');
    expect(cdi).toHaveAttribute('stroke-dasharray');
  });

  it('a dica mostra todas as séries visíveis na data', () => {
    const { container } = seriesChart();
    const svg = container.querySelector('svg') as SVGSVGElement;

    fireEvent.pointerMove(svg, { clientX: 60, clientY: 50 });

    const tooltip = screen.getByRole('status');
    expect(within(tooltip).getByText('Longo prazo')).toBeVisible();
    expect(within(tooltip).getByText('CDI')).toBeVisible();
  });

  it('a linha vertical acompanha o cursor', () => {
    const { container } = seriesChart();
    const svg = container.querySelector('svg') as SVGSVGElement;

    expect(container.querySelectorAll('line[stroke-dasharray="3 3"]')).toHaveLength(0);
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 50 });
    expect(container.querySelectorAll('line[stroke-dasharray="3 3"]')).toHaveLength(1);
  });

  it('clicar na legenda isola a série', async () => {
    const user = userEvent.setup();
    const { container } = seriesChart();

    await user.click(screen.getByRole('button', { name: 'CDI' }));

    expect(container.querySelectorAll('path[data-series="carteira"]')).toHaveLength(0);
    expect(container.querySelectorAll('path[data-series="cdi"]').length).toBeGreaterThan(
      0,
    );
  });

  it('clicar de novo na série isolada traz as outras de volta', async () => {
    const user = userEvent.setup();
    const { container } = seriesChart();

    await user.click(screen.getByRole('button', { name: 'CDI' }));
    await user.click(screen.getByRole('button', { name: 'CDI' }));

    expect(
      container.querySelectorAll('path[data-series="carteira"]').length,
    ).toBeGreaterThan(0);
  });

  it('o que a legenda esconde vale para a exportação', async () => {
    const user = userEvent.setup();
    const onVisibleChange = vi.fn();
    seriesChart({ onVisibleChange });

    await user.click(screen.getByRole('button', { name: 'CDI' }));

    expect(onVisibleChange).toHaveBeenLastCalledWith(['cdi']);
  });

  it('a área empilhada usa a faixa que a api resolveu, sem somar nada', () => {
    const { container } = seriesChart({
      series: [],
      bands: [
        {
          id: 'aportes',
          label: 'Aportes acumulados',
          color: 'var(--color-area-contributions)',
          values: dates.map((date, index) => ({
            date,
            from: '0',
            to: String(200000 + index * 1000),
          })),
        },
      ],
      valueFormat: 'money',
      fromZero: true,
    });

    expect(container.querySelectorAll('path[data-series="aportes"]')).toHaveLength(1);
  });
});

describe('barras de proporção', () => {
  it('a barra de alocação marca o alvo e diz o desvio em pontos', () => {
    wrap(
      <AllocationBar
        label="RF pós-fixada"
        colorToken="class.rf-pos"
        current="0.292"
        target="0.25"
        deviation="4.2"
        withinTolerance={false}
      />,
    );

    expect(screen.getByText('29,2%')).toBeVisible();
    expect(screen.getByText(/4,2 pp/u)).toBeVisible();
  });

  it('a barra nunca passa de cem por cento', () => {
    const { container } = wrap(
      <GoalProgressBar label="Reserva de emergência" progress="1.04" state="reached" />,
    );

    const fill = container.querySelector('span[style*="width"]') as HTMLElement;
    expect(fill.style.width).toBe('100%');
    expect(screen.getByText('104%')).toBeVisible();
  });

  it('objetivo atrasado troca de cor e explica no texto', () => {
    const { container } = wrap(
      <GoalProgressBar
        label="Viagem 2026"
        caption="prazo encerrou em jun/2026 · faltaram R$ 2.400"
        progress="0.92"
        state="behind"
      />,
    );

    expect(container.querySelector('.bg-negative')).not.toBeNull();
    expect(screen.getByText(/prazo encerrou/u)).toBeVisible();
  });

  it('fatia pequena continua visível na barra de composição', () => {
    const { container } = wrap(
      <CompositionBar
        label="Composição por classe"
        slices={[
          { id: 'a', label: 'Ações', colorToken: 'class.acoes', share: '0.997' },
          { id: 'b', label: 'Caixa', colorToken: 'class.caixa', share: '0.003' },
        ]}
      />,
    );

    const slices = container.querySelectorAll('span[style*="width"]');
    expect(slices).toHaveLength(2);
    expect((slices[1] as HTMLElement).className).toContain('min-w-0.5');
  });
});

describe('grade mês por ano', () => {
  const years = [
    {
      year: 2026,
      months: [
        '0.0077',
        '0.0134',
        '0.0172',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
      total: '0.1158',
      partial: true,
    },
    {
      year: 2025,
      months: [
        '0.0263',
        '0.0222',
        '0.0169',
        '-0.0146',
        '0.0023',
        '0.0209',
        '-0.0125',
        '0.0079',
        '0.0231',
        '-0.0063',
        '0.0289',
        '0.0162',
      ],
      total: '0.1381',
    },
  ];

  it('o número exato continua legível dentro da célula', () => {
    wrap(<MonthYearGrid years={years} format="percent" caption="Retornos mensais" />);
    expect(screen.getByText('0,77%')).toBeVisible();
    expect(screen.getByText('1,46%')).toBeVisible();
  });

  it('mês sem dado é mês sem dado, não mês de zero', () => {
    wrap(<MonthYearGrid years={years} format="percent" caption="Retornos mensais" />);
    expect(screen.getAllByText('·').length).toBeGreaterThan(0);
    expect(screen.queryByText('0,00%')).not.toBeInTheDocument();
  });

  it('a escala é a mesma da grade inteira e vem indicada', () => {
    const scale = intensityScale(years.flatMap((year) => year.months));
    expect(scale.extent).toBeCloseTo(0.0289, 6);
    expect(scale.of('0.0289')).toBe(1);
    expect(scale.of('-0.0289')).toBe(-1);
    expect(scale.of(null)).toBe(0);
  });

  it('o total do ano fica na última coluna', () => {
    wrap(<MonthYearGrid years={years} format="percent" caption="Retornos mensais" />);
    expect(screen.getByText('11,58%')).toBeVisible();
  });

  it('clicar em uma célula leva ao mês', async () => {
    const user = userEvent.setup();
    const onSelectMonth = vi.fn();
    wrap(
      <MonthYearGrid
        years={years}
        format="percent"
        caption="Retornos mensais"
        onSelectMonth={onSelectMonth}
      />,
    );

    await user.click(screen.getByText('1,34%'));
    expect(onSelectMonth).toHaveBeenCalledWith(2026, 2);
  });
});

describe('barras por mês', () => {
  it('as barras empilham os tipos e a dica abre o total', () => {
    const { container } = wrap(
      <MonthlyBarsChart
        ariaLabel="Proventos por mês"
        width={600}
        slices={[
          { id: 'dividendo', label: 'Dividendo', color: 'var(--color-series-1)' },
          { id: 'jcp', label: 'JCP', color: 'var(--color-series-2)' },
        ]}
        bars={[
          { label: 'set', values: ['800', '483.40'], total: '1283.40' },
          { label: 'out', values: ['900', '250'], total: '1150' },
        ]}
      />,
    );

    expect(container.querySelectorAll('rect[data-slice]')).toHaveLength(4);

    const firstBar = container.querySelector('rect[data-slice]')?.parentElement;
    fireEvent.pointerMove(firstBar as Element);
    expect(within(screen.getByRole('status')).getByText(/1\.283,40/u)).toBeVisible();
  });

  it('as barras começam em zero', () => {
    const { container } = wrap(
      <MonthlyBarsChart
        ariaLabel="Proventos por mês"
        width={600}
        slices={[{ id: 'dividendo', label: 'Dividendo', color: 'var(--color-series-1)' }]}
        bars={[
          { label: 'set', values: ['1000'], total: '1000' },
          { label: 'out', values: ['1100'], total: '1100' },
        ]}
      />,
    );

    const texts = Array.from(container.querySelectorAll('text')).map(
      (node) => node.textContent,
    );
    expect(texts).toContain('0');
  });
});
