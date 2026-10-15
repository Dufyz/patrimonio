/**
 * A lista de carteiras da barra lateral é lida uma vez, ao abrir o app. Quando
 * uma tela cria, renomeia ou exclui uma carteira, ela avisa por aqui e a barra
 * relê — sem o aviso, a carteira nova só apareceria ao recarregar a página.
 */
const EVENT = 'patrimonio:portfolios-changed';

export const notifyPortfoliosChanged = (): void => {
  globalThis.dispatchEvent(new Event(EVENT));
};

export const onPortfoliosChanged = (listener: () => void): (() => void) => {
  globalThis.addEventListener(EVENT, listener);
  return () => globalThis.removeEventListener(EVENT, listener);
};
