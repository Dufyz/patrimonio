import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * TEM-01 (3) e TEM-05 · As convenções visuais, verificadas a cada `pnpm test`.
 * Cada regra falha nomeando arquivo e linha, para a correção ser direta.
 */

// O vitest roda com o diretório do pacote como cwd.
const ROOT = join(process.cwd(), 'src');

const walk = (dir: string, extensions: readonly string[]): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, extensions);
    const isTest = /\.test\.tsx?$/.test(name);
    return !isTest && extensions.some((ext) => name.endsWith(ext)) ? [path] : [];
  });

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

const where = (file: string, source: ts.SourceFile, node: ts.Node): string =>
  `${relative(ROOT, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

describe('cursor: pointer em tudo que é clicável (TEM-05)', () => {
  const attributeText = (
    attributes: ts.JsxAttributes,
    source: ts.SourceFile,
    name: string,
  ): string | null => {
    const found = attributes.properties.find(
      (item): item is ts.JsxAttribute =>
        ts.isJsxAttribute(item) && item.name.getText(source) === name,
    );
    return found === undefined ? null : found.getText(source);
  };

  it('elemento HTML com onClick ou role="button" declara cursor-pointer', () => {
    const violations: string[] = [];
    for (const file of walk(ROOT, ['.tsx'])) {
      const source = parse(file);

      // Constantes de classe (`NAV_BASE = '... cursor-pointer ...'`) também valem.
      const withPointer = new Set<string>();
      const collect = (node: ts.Node): void => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer !== undefined &&
          node.initializer.getText(source).includes('cursor-pointer')
        ) {
          withPointer.add(node.name.text);
        }
        ts.forEachChild(node, collect);
      };
      collect(source);

      const visit = (node: ts.Node): void => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(source);
          const onClick = attributeText(node.attributes, source, 'onClick');
          const role = attributeText(node.attributes, source, 'role');
          // `onClick={(event) => event.stopPropagation()}` só impede o clique de
          // subir para a linha: o elemento não é clicável.
          const onlyStops =
            onClick !== null && /stopPropagation\(\)\s*\}?$/.test(onClick);
          const clickable =
            (onClick !== null && !onlyStops) || role?.includes('"button"');
          if (clickable === true && /^[a-z]/.test(tag)) {
            const className = attributeText(node.attributes, source, 'className') ?? '';
            const ok =
              className.includes('cursor-pointer') ||
              [...withPointer].some((name) => className.includes(name));
            if (!ok) violations.push(`${where(file, source, node)} <${tag}>`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });
});

/** Tira comentários, para a regra olhar só o que a pessoa pode ler na tela. */
const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, '$1');

describe('vocabulário (TEM-05)', () => {
  /**
   * "Fechamento" no sentido de consolidação é "consolidação". O fechamento da
   * fatura do cartão (dia de fechamento, fechamento e vencimento) é outra coisa e
   * continua valendo.
   */
  const CARD_SENSE =
    /dia de fechamento|fechamento e vencimento|fechamento da fatura|datas? de fechamento/gi;

  it('nenhuma tela, rótulo ou mensagem diz "fechamento" no sentido de consolidação', () => {
    const violations: string[] = [];
    for (const file of walk(ROOT, ['.ts', '.tsx'])) {
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (line.replace(CARD_SENSE, '').match(/fechamento/i) !== null) {
          violations.push(`${relative(ROOT, file)}:${index + 1}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('a marca "Patrimônio" não vem acompanhada de ícone', () => {
    const violations: string[] = [];
    for (const file of walk(ROOT, ['.tsx'])) {
      const source = parse(file);
      const visit = (node: ts.Node): void => {
        if (ts.isJsxElement(node)) {
          const isBrand = node.children.some(
            (child) =>
              ts.isJsxText(child) && child.getText(source).trim() === 'Patrimônio',
          );
          const hasIcon = node.children.some(
            (child) =>
              (ts.isJsxSelfClosingElement(child) &&
                /^(Icon|.*Icon|svg|img)$/.test(child.tagName.getText(source))) ||
              (ts.isJsxElement(child) &&
                /^(Icon|.*Icon|svg|img)$/.test(
                  child.openingElement.tagName.getText(source),
                )),
          );
          if (isBrand && hasIcon) violations.push(where(file, source, node));
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });
});

describe('cores só nos tokens (TEM-01)', () => {
  const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;

  it('nenhuma cor literal fora do arquivo de tokens', () => {
    const violations: string[] = [];
    for (const file of walk(ROOT, ['.ts', '.tsx', '.css'])) {
      // O arquivo de tokens é a única fonte de valores de cor.
      if (relative(ROOT, file) === 'styles.css') continue;
      stripComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, index) => {
          if (LITERAL.test(line)) violations.push(`${relative(ROOT, file)}:${index + 1}`);
        });
    }
    expect(violations).toEqual([]);
  });
});
