import type {
  AccountStatementResource,
  StatementLineResource,
} from '../api/statement_view.js';

/**
 * CTA-02 · O que o Extrato decide sobre as linhas que o servidor entrega.
 */
const SCALE = 8;

const scaled = (value: string): bigint => {
  const negative = value.startsWith('-');
  const [int = '0', frac = ''] = value.replace(/^[+-]/, '').split('.');
  const out = BigInt(int + frac.padEnd(SCALE, '0').slice(0, SCALE));
  return negative ? -out : out;
};

/** Saldo inicial + entradas − saídas = saldo final; se não fechar, a tela não mostra números. */
export const statementCloses = (
  s: Pick<AccountStatementResource, 'opening' | 'entered' | 'left' | 'closing'>,
): boolean =>
  scaled(s.opening) + scaled(s.entered) - scaled(s.left) === scaled(s.closing);

/** Da mais nova à mais antiga; o saldo após foi calculado em ordem cronológica. */
export const newestFirst = (
  lines: readonly StatementLineResource[],
): readonly StatementLineResource[] => [...lines].reverse();

const TYPE_LABEL: Readonly<Record<string, string>> = {
  lancamento: 'Lançamento',
  fatura: 'Fatura',
  transferencia_entrada: 'Transferência',
  transferencia_saida: 'Transferência',
  ajuste: 'Ajuste',
  aporte: 'Aporte',
  resgate: 'Resgate',
  provento: 'Provento',
};

export const typeLabel = (line: StatementLineResource): string =>
  line.origin === 'lancamento'
    ? scaled(line.amount) >= 0n
      ? 'Receita'
      : 'Despesa'
    : (TYPE_LABEL[line.origin] ?? line.origin);

/** "saldo de 01/11 · entrou R$ x · saiu R$ y". */
export const dayMonth = (iso: string): string => `${iso.slice(8)}/${iso.slice(5, 7)}`;
