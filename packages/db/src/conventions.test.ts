import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * QUA-07 · As convenções do repositório que não regridem em silêncio.
 *
 * - SQL com palavra-chave em maiúsculas, em migrations e em repositórios: o
 *   estilo é do projeto, e uma consulta com `select` minúsculo é o sinal de que
 *   alguém colou de outro lugar sem ler.
 * - O que o produto decidiu não ter (autenticação, `user_id`, cripto) continua
 *   não existindo: o esquema é de uma pessoa só.
 */

const here = import.meta.dirname;
const migrationsDir = join(here, 'migrations');
const repositoriesDir = join(here, 'repositories');

const KEYWORDS = [
  'select',
  'from',
  'where',
  'insert into',
  'delete from',
  'update',
  'values',
  'returning',
  'left join',
  'inner join',
  'join',
  'group by',
  'order by',
  'on conflict',
  'create table',
  'alter table',
  'create index',
  'drop table',
  'limit',
  'union all',
  'having',
] as const;

/** `from` e `update` aparecem como palavra em prosa dentro de comentários: tiramos antes. */
const stripSqlComments = (sql: string): string =>
  sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** O que está entre aspas simples é dado, não SQL: `'order by'` num texto não conta. */
const stripSqlStrings = (sql: string): string => sql.replace(/'(?:[^']|'')*'/g, "''");

const lowercaseKeywords = (sql: string): string[] => {
  const cleaned = stripSqlStrings(stripSqlComments(sql));
  const found: string[] = [];

  for (const keyword of KEYWORDS) {
    const pattern = new RegExp(
      `(?<![\\w.])${keyword.replace(' ', '\\s+')}(?![\\w])`,
      'g',
    );
    for (const match of cleaned.matchAll(pattern)) {
      // Só vale a palavra inteira em minúsculas; a mesma em maiúsculas é o estilo.
      if (match[0] === match[0].toLowerCase()) found.push(match[0]);
    }
  }

  return found;
};

/** O texto fixo de cada template `sql`...`` e `unsafe(`...`)`, sem o que vai em `${}`. */
const sqlTemplates = (source: string): string[] => {
  const found: string[] = [];
  const opener = /(?:\b(?:sql|tx)(?:<[^`]*?>)?|\.unsafe\()\s*`/g;

  for (const match of source.matchAll(opener)) {
    let index = (match.index ?? 0) + match[0].length;
    let text = '';
    while (index < source.length && source[index] !== '`') {
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === '$' && source[index + 1] === '{') {
        let depth = 1;
        index += 2;
        while (index < source.length && depth > 0) {
          if (source[index] === '{') depth += 1;
          if (source[index] === '}') depth -= 1;
          index += 1;
        }
        text += ' ';
        continue;
      }
      text += source[index];
      index += 1;
    }
    found.push(text);
  }

  return found;
};

const files = (dir: string, extension: string, skip: RegExp | null = null): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith(extension) && (skip === null || !skip.test(name)))
    .map((name) => join(dir, name));

describe('SQL com palavra-chave em maiúsculas (QUA-07)', () => {
  it('o varredor encontra os arquivos e as consultas que deve varrer', () => {
    expect(files(migrationsDir, '.sql').length).toBeGreaterThan(80);
    const templates = files(repositoriesDir, '.ts', /\.test\.ts$/).flatMap((file) =>
      sqlTemplates(readFileSync(file, 'utf8')),
    );
    expect(templates.length).toBeGreaterThan(150);
  });

  it('as migrations não usam palavra-chave em minúsculas', () => {
    const offenders = files(migrationsDir, '.sql').flatMap((file) =>
      lowercaseKeywords(readFileSync(file, 'utf8')).map(
        (word) => `${file.replace(here, '')}: ${word}`,
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('os repositórios não usam palavra-chave em minúsculas nas consultas', () => {
    const offenders = files(repositoriesDir, '.ts', /\.test\.ts$/).flatMap((file) =>
      sqlTemplates(readFileSync(file, 'utf8')).flatMap((sql) =>
        lowercaseKeywords(sql).map((word) => `${file.replace(here, '')}: ${word}`),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('o verificador enxerga o que deve: select minúsculo falha e SELECT passa', () => {
    expect(lowercaseKeywords('select 1 from t')).toEqual(['select', 'from']);
    expect(lowercaseKeywords('SELECT 1 FROM t -- from prosa')).toEqual([]);
    expect(lowercaseKeywords("SELECT 'order by' FROM t")).toEqual([]);
    expect(sqlTemplates('await sql`select ${a} from t`')).toEqual(
      ['select   from t'].map((s) => s),
    );
  });
});

describe('o que o produto decidiu não ter (QUA-07)', () => {
  const schema = files(join(migrationsDir, 'up'), '.sql')
    .map((file) => stripSqlComments(readFileSync(file, 'utf8')))
    .join('\n');

  it('não há tabela de usuário, sessão nem coluna user_id: o app é de uma pessoa só', () => {
    expect(schema).not.toMatch(/\buser_id\b/i);
    expect(schema).not.toMatch(
      /CREATE TABLE\s+("?)(users?|sessions?|accounts_auth|credentials)\1\b/i,
    );
    expect(schema).not.toMatch(/\bpassword(_hash)?\b/i);
  });

  it('não há cripto: nenhum tipo de ativo, moeda ou coluna de carteira on-chain', () => {
    expect(schema).not.toMatch(/\b(crypto|bitcoin|wallet_address|blockchain)\b/i);
  });
});
