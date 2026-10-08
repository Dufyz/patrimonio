/**
 * Preferências de leitura que vivem no navegador: tema, densidade, valores
 * ocultos e a escolha de colunas de cada tabela. São do aparelho, não da conta
 * — a tela de Configurações diz isso com todas as letras ("valem para este
 * navegador") —, então não vão para a `api`.
 *
 * Toda leitura é defensiva. `localStorage` lança em janela anônima com cookies
 * bloqueados, e uma preferência de exibição não pode derrubar a aplicação.
 */

export type Storageish = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const browserStorage = (): Storageish | null => {
  try {
    const probe = globalThis.localStorage;
    probe.getItem('');
    return probe;
  } catch {
    return null;
  }
};

export const readRaw = (storage: Storageish | null, key: string): string | null => {
  if (storage === null) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

export const writeRaw = (
  storage: Storageish | null,
  key: string,
  value: string,
): void => {
  if (storage === null) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Cota cheia ou armazenamento bloqueado: a preferência vale só nesta sessão.
  }
};

/**
 * Lê um valor que só pode ser um dos listados. Qualquer outra coisa — chave
 * ausente, lixo de uma versão anterior — cai no padrão, em vez de propagar um
 * estado que nenhuma tela sabe desenhar.
 */
export const readEnum = <T extends string>(
  storage: Storageish | null,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T => {
  const raw = readRaw(storage, key);
  return raw !== null && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
};

export const readBoolean = (
  storage: Storageish | null,
  key: string,
  fallback: boolean,
): boolean => {
  const raw = readRaw(storage, key);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
};

export const readJson = <T>(
  storage: Storageish | null,
  key: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): T => {
  const raw = readRaw(storage, key);
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

export const writeJson = (
  storage: Storageish | null,
  key: string,
  value: unknown,
): void => {
  writeRaw(storage, key, JSON.stringify(value));
};
