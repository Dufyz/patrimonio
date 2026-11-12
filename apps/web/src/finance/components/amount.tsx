import { MoneyChange, Money } from '../../components/number.js';
import { centsToDecimal } from '../lib/money.js';
import type { Cents } from '../lib/money.js';

/**
 * Valor monetário de Finanças: formato brasileiro, mono, alinhado à direita.
 * O mascaramento de "ocultar valores" vem dos componentes de número.
 *
 * - `plain`: saldo e total, sem sinal quando positivo.
 * - `flow`: lançamento com sinal — despesa com `−`, receita com `+` e verde.
 * - `delta`: variação, verde quando sobe e vermelha quando desce.
 * - `signed`: sempre com sinal, mas sem cor (saldo do período).
 */

export type AmountVariant = 'plain' | 'flow' | 'delta' | 'signed';

export const Amount = ({
  cents,
  variant = 'plain',
  className,
}: {
  readonly cents: Cents;
  readonly variant?: AmountVariant;
  readonly className?: string | undefined;
}): React.ReactElement => {
  const value = centsToDecimal(cents);
  const props = className === undefined ? {} : { className };

  if (variant === 'plain') return <Money value={value} {...props} />;
  if (variant === 'signed')
    return <MoneyChange value={value} tone="neutral" {...props} />;
  if (variant === 'delta') return <MoneyChange value={value} tone="signed" {...props} />;
  return <MoneyChange value={value} tone={cents > 0 ? 'signed' : 'neutral'} {...props} />;
};
