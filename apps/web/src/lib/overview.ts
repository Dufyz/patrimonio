import type { OverviewAttentionItemResource, OverviewPointResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';

import type { Band } from './chart/series.js';
import { parseDecimal, shiftPoint } from './decimal.js';
import { SEMANTIC_COLORS } from './tokens.js';

/**
 * T-01 · As decisões da tela de abertura.
 *
 * Regra que decide alguma coisa não mora em componente, porque componente não
 * tem teste de lógica. O que está aqui é o que a tela precisa resolver antes
 * de desenhar: como a série vira faixa empilhada, como um percentual da `api`
 * vira razão para o formatador, e que texto cada regra de alerta produz.
 */

/**
 * A `api` fala em percentual — `tolerance_pp`, `target_pct`, `weight_pct` — e o
 * design system fala em razão: `formatPercent("0.0025")` é `0,25%`. A ponte é
 * mover a vírgula sobre a string, exatamente como a formatação já faz, e não
 * dividir por cem: dividir converteria para `number`, que é a conversão que o
 * projeto inteiro evita.
 */
export const percentAsRatio = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;

  const parts = parseDecimal(value);
  if (parts === null) return null;

  const shifted = shiftPoint(parts, -2);
  const body =
    shifted.fraction === '' ? shifted.integer : `${shifted.integer}.${shifted.fraction}`;

  return shifted.negative ? `-${body}` : body;
};

/**
 * As duas faixas do gráfico de evolução, empilhadas: o aporte acumulado
 * embaixo e o que o mercado acrescentou em cima. A `api` manda os dois lados
 * já calculados, então aqui só se decide o par de cada faixa.
 *
 * Patrimônio abaixo do aporte — prejuízo — inverte a faixa de cima, que passa
 * a descer do aporte até o patrimônio e muda de cor. Cortá-la em zero
 * esconderia justamente o caso em que olhar o gráfico importa.
 */
export type GrowthBands = {
  readonly dates: readonly DateOnly[];
  readonly contributions: readonly Band[];
  readonly result: readonly Band[];
  readonly underwater: boolean;
};

export const growthBands = (
  points: readonly OverviewPointResource[],
): GrowthBands => ({
  dates: points.map((point) => point.date as DateOnly),
  contributions: points.map((point) => ({
    date: point.date as DateOnly,
    from: '0',
    to: point.contributions,
  })),
  result: points.map((point) => ({
    date: point.date as DateOnly,
    from: point.contributions,
    to: point.total,
  })),
  underwater: points.some((point) => point.result.startsWith('-')),
});

export const resultColor = (underwater: boolean): string =>
  underwater ? SEMANTIC_COLORS.loss : SEMANTIC_COLORS.return;

export const CONTRIBUTIONS_COLOR = SEMANTIC_COLORS.contributions;

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** `2026-10-02` → `em outubro`, que é o rótulo da variação do mês. */
export const monthLabel = (date: DateOnly | null): string => {
  if (date === null) return 'no mês';
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  return month === undefined ? 'no mês' : `em ${month}`;
};

/** `2026-10-02` → `02/10/2026`. A data já chega como string, sem fuso. */
export const formatDate = (date: DateOnly | null): string =>
  date === null ? '—' : date.split('-').reverse().join('/');

const MONTH_ABBREVIATIONS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

/**
 * Os rótulos do eixo de uma série longa são por mês, não por dia: doze meses
 * de fechamento são duzentos e tantos pontos, e `06/10` repetido não diz nada.
 * O ano aparece onde ele muda — `out/25`, `dez`, `fev/26` —, que é a regra da
 * prancha e também o mínimo para a leitura não ficar ambígua.
 */
export const monthTicks = (
  dates: readonly DateOnly[],
): ReadonlyMap<DateOnly, string> => {
  const labels = new Map<DateOnly, string>();
  let lastYear: string | null = null;

  for (const date of dates) {
    const year = date.slice(0, 4);
    const month = MONTH_ABBREVIATIONS[Number(date.slice(5, 7)) - 1] ?? '';

    labels.set(date, year === lastYear ? month : `${month}/${year.slice(2)}`);
    lastYear = year;
  }

  return labels;
};

/**
 * `3.00` → `3`. A tolerância é escrita como a pessoa a declarou — "3 pp" —, e
 * não com as casas que o `NUMERIC` carrega.
 */
export const trimDecimals = (value: string): string => {
  if (!value.includes('.')) return value;

  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
};

export const GROUP_LABELS = {
  corrigir: 'Corrigir dados',
  decidir: 'Decidir',
  acompanhar: 'Acompanhar',
} as const;

const text = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === 'string' && value !== '' ? value : null;
};

export type AttentionText = {
  readonly title: string;
  /** O que o alerta diz, montado com o que a regra gravou. */
  readonly detail: string;
  /** O verbo do atalho à direita. Nulo enquanto a tela de destino não existe. */
  readonly action: string | null;
};

/**
 * O texto de cada regra. A tela nunca mostra `rule_kind` cru, e o que uma regra
 * ainda sem tradução produz é o rótulo genérico com o que ela gravou — pior
 * que um texto próprio, melhor que `price_stale` aparecendo na tela.
 *
 * As dez regras que faltam chegam em E7 e entram neste mapa.
 */
export const attentionText = (item: OverviewAttentionItemResource): AttentionText => {
  const ticker = text(item.payload, 'ticker') ?? text(item.payload, 'asset_id');

  switch (item.rule_kind) {
    case 'price_stale': {
      const since = text(item.payload, 'last_price_date');
      return {
        title: 'Preço atrasado',
        detail:
          since === null
            ? `${ticker ?? 'Um papel'} está sem cotação da fonte principal.`
            : `${ticker ?? 'Um papel'} sem cotação da fonte principal desde ${formatDate(
                since as DateOnly,
              )}; a posição usa o último preço conhecido.`,
        action: 'Definir preço manual',
      };
    }

    case 'price_missing':
      return {
        title: 'Preço ausente',
        detail: `${ticker ?? 'Um papel'} nunca teve cotação: a posição vale o custo, e a linha fica marcada.`,
        action: 'Definir preço manual',
      };

    case 'corporate_event_pending': {
      const kind = text(item.payload, 'kind');
      const recordDate = text(item.payload, 'record_date');
      const from = text(item.payload, 'ratio_from');
      const to = text(item.payload, 'ratio_to');
      const terms = from !== null && to !== null ? ` ${from}:${to}` : '';

      return {
        title: 'Evento corporativo',
        detail: `${ticker ?? 'Um papel'} tem ${kind ?? 'evento'}${terms} com data-com em ${formatDate(
          (recordDate ?? null) as DateOnly | null,
        )}; a quantidade muda só depois da confirmação.`,
        action: 'Revisar evento',
      };
    }

    default:
      return {
        title: item.rule_kind.replace(/_/g, ' '),
        detail: `Pendência aberta em ${formatDate(item.first_seen_at.slice(0, 10) as DateOnly)}.`,
        action: null,
      };
  }
};
