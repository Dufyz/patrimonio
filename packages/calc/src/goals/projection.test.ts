import { describe, expect, it } from 'vitest';

import {
  alreadyReached,
  independenceInNominalBrl,
  independenceInTodayBrl,
  simpleTwelveMonths,
} from '../__fixtures__/goals/projection.js';
import {
  averageMonthlyContribution,
  contributionTable,
  projectGoal,
} from './projection.js';

describe('meta em reais de hoje', () => {
  const projection = projectGoal(independenceInTodayBrl);

  it('a meta é corrigida pelo IPCA até a data alvo', () => {
    expect(projection.months_remaining).toBe(120);
    expect(projection.target_amount_nominal).toBe('740122.14');
  });

  it('a meta em reais nominais não é corrigida', () => {
    expect(projectGoal(independenceInNominalBrl).target_amount_nominal).toBe(
      '500000.00',
    );
  });

  it('o progresso é medido contra a meta corrigida, não contra o valor digitado', () => {
    // 120 mil sobre 740 mil é 16,21%; sobre 500 mil daria 24% e enganaria.
    expect(projection.progress_pct).toBe('16.21');
    expect(projectGoal(independenceInNominalBrl).progress_pct).toBe('24.00');
  });
});

describe('ritmo atual e aporte necessário', () => {
  const projection = projectGoal(independenceInTodayBrl);

  it('o ritmo atual projeta onde a carteira chega na data alvo', () => {
    expect(projection.projected_amount).toBe('544369.13');
  });

  it('o aporte necessário sai da premissa de retorno declarada', () => {
    expect(projection.required_monthly).toBe('3834.42');
  });

  it('aporte abaixo do necessário devolve data de chegada posterior à meta', () => {
    expect(projection.on_track).toBe(false);
    expect(projection.months_to_arrival).toBe(211);
    expect(projection.arrival_date).toBe('2043-08-01');
    // A data de chegada passa de 2036-01-01, que é a data alvo.
    expect(projection.arrival_date! > independenceInTodayBrl.target_date).toBe(true);
  });

  it('o que falta na data alvo aparece com sinal', () => {
    expect(projection.gap_brl).toBe('195753.01');
  });

  it('com o aporte necessário o objetivo passa a fechar na data', () => {
    const corrigido = projectGoal({
      ...independenceInTodayBrl,
      monthly_contribution: projection.required_monthly,
    });

    expect(corrigido.on_track).toBe(true);
    expect(corrigido.months_to_arrival).not.toBeNull();
    expect(corrigido.months_to_arrival!).toBeLessThanOrEqual(120);
  });
});

describe('conta sem retorno e sem inflação', () => {
  const projection = projectGoal(simpleTwelveMonths);

  it('doze aportes de dez mil fecham cento e vinte mil', () => {
    expect(projection.projected_amount).toBe('120000.00');
    expect(projection.required_monthly).toBe('10000.00');
    expect(projection.on_track).toBe(true);
    expect(projection.months_to_arrival).toBe(12);
    expect(projection.arrival_date).toBe('2027-01-01');
    expect(projection.gap_brl).toBe('0.00');
  });

  it('sem aporte nenhum e sem retorno, não se chega nunca', () => {
    const parado = projectGoal({
      ...simpleTwelveMonths,
      monthly_contribution: '0.00',
    });

    expect(parado.arrival_date).toBeNull();
    expect(parado.months_to_arrival).toBeNull();
    expect(parado.on_track).toBe(false);
  });
});

describe('objetivo já cumprido', () => {
  const projection = projectGoal(alreadyReached);

  it('o progresso nunca passa de 100%: o excedente vira texto', () => {
    expect(projection.progress_pct).toBe('100.00');
    expect(projection.surplus_brl).toBe('50000.00');
  });

  it('o aporte necessário é zero, não um número negativo', () => {
    expect(projection.required_monthly).toBe('0.00');
    expect(projection.months_to_arrival).toBe(0);
  });

  it('quem não cumpriu não tem excedente', () => {
    expect(projectGoal(simpleTwelveMonths).surplus_brl).toBeNull();
  });
});

describe('data alvo no passado ou hoje', () => {
  it('a data alvo já vencida não devolve período negativo', () => {
    const vencido = projectGoal({
      ...simpleTwelveMonths,
      target_date: '2025-01-01',
    });

    expect(vencido.months_remaining).toBe(0);
    expect(vencido.projected_amount).toBe('0.00');
    // Sem tempo nenhum, o necessário é a diferença inteira.
    expect(vencido.required_monthly).toBe('120000.00');
  });

  it('meta zero não divide por zero', () => {
    const semMeta = projectGoal({ ...simpleTwelveMonths, target_amount: '0.00' });

    expect(semMeta.progress_pct).toBe('0.00');
  });
});

describe('tabela de aporte contra data de chegada', () => {
  it('mostra o que cada aporte muda na data de chegada', () => {
    const table = contributionTable(independenceInTodayBrl, [
      '2500.00',
      '3500.00',
      '5000.00',
      '10000.00',
    ]);

    expect(table.map((row) => row.months_to_arrival)).toEqual([211, 135, 88, 41]);
    expect(table.map((row) => row.reaches_target_date)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(table[2]?.arrival_date).toBe('2033-05-01');
  });

  it('aporte que não chega em cem anos devolve traço em vez de uma data absurda', () => {
    const table = contributionTable(
      { ...independenceInTodayBrl, annual_return_pct: '0' },
      ['1.00'],
    );

    expect(table[0]?.arrival_date).toBeNull();
    expect(table[0]?.reaches_target_date).toBe(false);
  });
});

describe('ritmo atual pelos últimos doze meses', () => {
  const flows = [
    { month: '2025-02', net_flow: '1000.00' },
    { month: '2025-03', net_flow: '2000.00' },
    { month: '2025-04', net_flow: '3000.00' },
  ];

  it('a média é sobre doze meses, e o mês sem aporte entra como zero', () => {
    // 6.000 em doze meses são 500 por mês, não 2.000.
    expect(averageMonthlyContribution(flows)).toBe('500.00');
  });

  it('a janela é parâmetro: três meses de ritmo dão outra média', () => {
    expect(averageMonthlyContribution(flows, 3)).toBe('2000.00');
  });

  it('só os meses mais recentes entram na janela', () => {
    const comHistorico = [
      { month: '2024-01', net_flow: '99000.00' },
      ...flows,
    ];

    expect(averageMonthlyContribution(comHistorico, 3)).toBe('2000.00');
  });

  it('sem fluxo nenhum o ritmo é zero', () => {
    expect(averageMonthlyContribution([])).toBe('0.00');
    expect(averageMonthlyContribution(flows, 0)).toBe('0.00');
  });

  it('resgate reduz o ritmo: a média é líquida', () => {
    expect(
      averageMonthlyContribution(
        [
          { month: '2025-03', net_flow: '3000.00' },
          { month: '2025-04', net_flow: '-1000.00' },
        ],
        2,
      ),
    ).toBe('1000.00');
  });
});
