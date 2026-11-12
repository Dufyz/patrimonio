import { readFile } from 'node:fs/promises';

import type { BackupEntry } from './retention.js';

/**
 * Storage do Supabase pela API REST. O bucket é privado, e o que sobe já está
 * cifrado — o token daqui dá acesso ao arquivo, não ao conteúdo.
 */
export type StorageOptions = {
  readonly baseUrl: string;
  readonly token: string;
  readonly bucket: string;
};

export type BackupStorage = {
  readonly upload: (name: string, path: string) => Promise<void>;
  readonly list: () => Promise<BackupEntry[]>;
  readonly remove: (names: readonly string[]) => Promise<void>;
  /** O tamanho do objeto no destino, ou nulo se ele não está lá. */
  readonly size: (name: string) => Promise<number | null>;
};

const DATE_IN_NAME = /(\d{4}-\d{2}-\d{2})/;

export const createBackupStorage = (options: StorageOptions): BackupStorage => {
  const headers = { Authorization: `Bearer ${options.token}` };
  const objectUrl = (name: string): string =>
    `${options.baseUrl.replace(/\/$/, '')}/object/${options.bucket}/${name}`;

  return {
    upload: async (name, path) => {
      const body = await readFile(path);
      const response = await fetch(objectUrl(name), {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: new Uint8Array(body),
      });

      if (!response.ok) {
        throw new Error(
          `upload do backup falhou: ${response.status} ${await response.text()}`,
        );
      }
    },

    size: async (name) => {
      const response = await fetch(objectUrl(name), { method: 'HEAD', headers });
      if (response.status === 404 || response.status === 400) return null;
      if (!response.ok) {
        throw new Error(`verificação do backup falhou: ${response.status}`);
      }
      const length = Number(response.headers.get('content-length'));
      return Number.isFinite(length) ? length : null;
    },

    list: async () => {
      const response = await fetch(
        `${options.baseUrl.replace(/\/$/, '')}/object/list/${options.bucket}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix: '', limit: 1_000, offset: 0 }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `listagem do backup falhou: ${response.status} ${await response.text()}`,
        );
      }

      const objects = (await response.json()) as ReadonlyArray<{ name: string }>;

      return objects.flatMap((object) => {
        const match = DATE_IN_NAME.exec(object.name);
        return match?.[1] === undefined ? [] : [{ name: object.name, date: match[1] }];
      });
    },

    remove: async (names) => {
      if (names.length === 0) return;

      const response = await fetch(
        `${options.baseUrl.replace(/\/$/, '')}/object/${options.bucket}`,
        {
          method: 'DELETE',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: [...names] }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `remoção de backup antigo falhou: ${response.status} ${await response.text()}`,
        );
      }
    },
  };
};
