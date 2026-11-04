import { randomBytes } from 'node:crypto';

/**
 * UUID v7: 48 bits de milissegundos na frente, o resto aleatório. O id cresce com
 * o tempo, e é isso que dá a uma lista ordenada por data uma ordem estável entre
 * registros do mesmo dia.
 */
export const uuidV7 = (now: () => Date = () => new Date()): string => {
  const bytes = randomBytes(16);
  const ms = BigInt(now().getTime());
  for (let i = 0; i < 6; i += 1) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
