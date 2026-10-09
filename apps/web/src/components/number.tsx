import type { FormattedNumber, NumberInput } from '../lib/format.js';
import {
  formatCompact,
  formatMoney,
  formatMoneyChange,
  formatPercent,
  formatPoints,
  formatQuantity,
  formatQuota,
} from '../lib/format.js';
import { useValuesHidden } from './preferences.js';

/**
 * D-02 · Os componentes de número.
 *
 * Toda a aplicação passa por aqui, e é por isso que eles são tão pequenos: a
 * decisão de formato mora em `lib/format.ts`, que tem teste de tabela; o que
 * sobra é a classe mono tabular e a cor do sinal.
 *
 * Positivo e negativo não se distinguem só por cor. O sinal é obrigatório e
 * ocupa uma coluna própria de largura fixa, então `+` e `−` caem exatamente um
 * sobre o outro em uma coluna de variação — quem não distingue as duas cores lê
 * a direção pelo glifo e pela posição dele.
 */

type Tone = 'neutral' | 'signed' | 'muted' | 'attention';

type NumberCellProps = {
  readonly value: FormattedNumber;
  readonly tone?: Tone;
  readonly className?: string;
  readonly title?: string;
};

const toneClass = (tone: Tone, value: FormattedNumber): string => {
  if (!value.available) return 'text-ink-3';
  if (tone === 'muted') return 'text-ink-3';
  if (tone === 'attention') return 'text-attention';
  if (tone === 'neutral') return '';
  if (value.sign === '+') return 'text-positive';
  if (value.sign === '−') return 'text-negative';
  return '';
};

/**
 * O número em si. O sinal vai em um `span` de largura fixa — `ch` da mono, que
 * é a largura de um dígito —, de modo que a coluna alinha pela vírgula mesmo
 * misturando valor com sinal e valor sem.
 */
const NumberCell = ({
  value,
  tone = 'neutral',
  className,
  title,
}: NumberCellProps): React.ReactElement => (
  <span
    className={['tabular whitespace-nowrap', toneClass(tone, value), className]
      .filter((part) => part !== undefined && part !== '')
      .join(' ')}
    {...(title === undefined ? {} : { title })}
    {...(value.masked ? { 'aria-label': 'valor oculto' } : {})}
  >
    {value.sign === '' ? null : (
      <span className="inline-block w-[1ch] text-center">{value.sign}</span>
    )}
    {value.body}
  </span>
);

type ValueProps = {
  readonly value: NumberInput;
  readonly decimals?: number;
  /** Omite o `R$` numa coluna que é inteira de reais. Ver `formatMoney`. */
  readonly bare?: boolean;
  readonly tone?: Tone;
  readonly className?: string;
  /** Força o valor a aparecer mesmo com o modo de valores ocultos ligado. */
  readonly alwaysVisible?: boolean;
};

/** Valor em reais: `R$ 1.204,10`. Escondido vira `R$ •••••`. */
export const Money = ({
  value,
  decimals,
  bare = false,
  tone = 'neutral',
  className,
  alwaysVisible = false,
}: ValueProps): React.ReactElement => {
  const hidden = useValuesHidden() && !alwaysVisible;
  return (
    <NumberCell
      value={formatMoney(value, {
        hidden,
        bare,
        ...(decimals === undefined ? {} : { decimals }),
      })}
      tone={tone}
      {...(className === undefined ? {} : { className })}
    />
  );
};

/** Variação em reais, sempre com sinal: `+R$ 1.204,10`, `−R$ 3.170,00`. */
export const MoneyChange = ({
  value,
  decimals,
  bare = false,
  className,
  alwaysVisible = false,
}: Omit<ValueProps, 'tone'>): React.ReactElement => {
  const hidden = useValuesHidden() && !alwaysVisible;
  return (
    <NumberCell
      value={formatMoneyChange(value, {
        hidden,
        bare,
        ...(decimals === undefined ? {} : { decimals }),
      })}
      tone="signed"
      {...(className === undefined ? {} : { className })}
    />
  );
};

type PercentProps = ValueProps & { readonly signed?: boolean };

/** Percentual a partir da razão. Nunca é escondido. */
export const Percent = ({
  value,
  decimals,
  signed = false,
  tone = 'neutral',
  className,
}: PercentProps): React.ReactElement => (
  <NumberCell
    value={formatPercent(value, {
      signed,
      ...(decimals === undefined ? {} : { decimals }),
    })}
    tone={tone}
    {...(className === undefined ? {} : { className })}
  />
);

/** Variação percentual: percentual com sinal e cor de resultado. */
export const PercentChange = ({
  value,
  decimals,
  className,
}: Omit<ValueProps, 'tone' | 'alwaysVisible'>): React.ReactElement => (
  <NumberCell
    value={formatPercent(value, {
      signed: true,
      ...(decimals === undefined ? {} : { decimals }),
    })}
    tone="signed"
    {...(className === undefined ? {} : { className })}
  />
);

/** Diferença em pontos percentuais: `+4,2 pp`. */
export const Points = ({
  value,
  decimals,
  tone = 'signed',
  className,
}: ValueProps): React.ReactElement => (
  <NumberCell
    value={formatPoints(value, { ...(decimals === undefined ? {} : { decimals }) })}
    tone={tone}
    {...(className === undefined ? {} : { className })}
  />
);

/** Quantidade de papéis ou cotas. */
export const Quantity = ({
  value,
  decimals,
  tone = 'neutral',
  className,
}: ValueProps): React.ReactElement => (
  <NumberCell
    value={formatQuantity(value, { ...(decimals === undefined ? {} : { decimals }) })}
    tone={tone}
    {...(className === undefined ? {} : { className })}
  />
);

/** Valor da cota da carteira. */
export const Quota = ({
  value,
  decimals,
  tone = 'neutral',
  className,
  alwaysVisible = false,
}: ValueProps): React.ReactElement => {
  const hidden = useValuesHidden() && !alwaysVisible;
  return (
    <NumberCell
      value={formatQuota(value, {
        hidden,
        ...(decimals === undefined ? {} : { decimals }),
      })}
      tone={tone}
      {...(className === undefined ? {} : { className })}
    />
  );
};

/** Forma compacta, para eixo de gráfico e barra lateral: `318,9k`. */
export const Compact = ({
  value,
  decimals,
  tone = 'muted',
  className,
  alwaysVisible = false,
}: ValueProps): React.ReactElement => {
  const hidden = useValuesHidden() && !alwaysVisible;
  return (
    <NumberCell
      value={formatCompact(value, {
        hidden,
        ...(decimals === undefined ? {} : { decimals }),
      })}
      tone={tone}
      {...(className === undefined ? {} : { className })}
    />
  );
};

/**
 * O número principal do cabeçalho de visão geral. Mesma formatação, corpo
 * maior: é o que responde à pergunta da tela, então vem antes de tudo.
 */
export const PrincipalMoney = ({
  value,
  alwaysVisible = false,
}: Pick<ValueProps, 'value' | 'alwaysVisible'>): React.ReactElement => {
  const hidden = useValuesHidden() && !alwaysVisible;
  return (
    <NumberCell
      value={formatMoney(value, { hidden })}
      className="text-principal leading-none font-semibold tracking-tight"
    />
  );
};
