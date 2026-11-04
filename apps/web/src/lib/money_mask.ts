/**
 * Máscara de dinheiro para campo de formulário.
 *
 * A pessoa digita `1234,5` e o campo mostra `1.234,5`: o milhar ganha ponto, a
 * vírgula continua sendo o separador decimal e o número de casas é limitado. É
 * máscara de texto, não de centavos — o campo não empurra dígitos para a
 * direita —, porque preço de cota e provento por ação têm mais de duas casas, e
 * "digitei 36,84 e apareceu 0,36" é o erro que a máscara de centavos comete com
 * quem cola ou edita no meio.
 *
 * Nada aqui passa por `number`: é dinheiro, e a conversão para o contrato fica
 * em `parseAmountInput`, de texto para texto.
 */

/** Ponto só com grupos de exatos três dígitos: é milhar, não decimal. */
const THOUSANDS = /^\d{1,3}(\.\d{3})+$/;

export const maskMoney = (raw: string, maxDecimals = 2): string => {
  const text = raw.replace(/[^\d.,]/g, '');
  if (text === '') return '';

  let integer: string;
  let fraction: string | null = null;

  if (text.includes(',')) {
    const at = text.indexOf(',');
    integer = text.slice(0, at).replace(/[.,]/g, '');
    fraction = text.slice(at + 1).replace(/[.,]/g, '');
  } else if (text.includes('.') && !THOUSANDS.test(text)) {
    // `36.84` e `1234.` são decimais com ponto; `1.234` é milhar.
    const at = text.lastIndexOf('.');
    integer = text.slice(0, at).replaceAll('.', '');
    fraction = text.slice(at + 1);
  } else {
    integer = text.replaceAll('.', '');
  }

  integer = integer.replace(/^0+(?=\d)/, '');
  if (integer === '' && fraction !== null) integer = '0';

  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (fraction === null || maxDecimals <= 0) return grouped;

  return `${grouped},${fraction.slice(0, maxDecimals)}`;
};
