import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * `no-restricted-syntax` não soma entre blocos de configuração: o último bloco
 * que casa com o arquivo substitui a lista inteira. Por isso as restrições
 * ficam em constantes e cada bloco declara a lista completa que quer.
 */
const NO_PROCESS_ENV = [
  {
    selector:
      "MemberExpression[object.object.name='process'][object.property.name='env']",
    message: 'Só packages/env lê process.env. Importe `environment` de @patrimonio/env.',
  },
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message: 'Só packages/env lê process.env. Importe `environment` de @patrimonio/env.',
  },
];

/**
 * D-01 · Nenhuma cor literal dentro de um componente.
 *
 * A camada de token existe para que uma classe de ativo tenha a mesma cor na
 * tabela, no gráfico e na barra. Um `#d07f1d` solto em um componente é o
 * primeiro passo para Ações ficarem de dois tons diferentes na mesma tela, e
 * ninguém percebe até ver as duas lado a lado. As cores moram em `styles.css`;
 * `lib/tokens.ts` é a única tradução de token para `var(--...)`.
 */
const NO_LITERAL_COLOR = [
  {
    selector: 'Literal[value=/#[0-9a-fA-F]{3}/]',
    message:
      'Cor literal não entra em componente. Use um token de `styles.css` ou `colorForToken`.',
  },
  {
    selector: 'Literal[value=/\\b(rgba?|hsla?|oklch|color-mix)\\s*\\(/]',
    message:
      'Cor literal não entra em componente. Use um token de `styles.css` ou `colorForToken`.',
  },
];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': ['error', ...NO_PROCESS_ENV],
      'no-restricted-globals': [
        'error',
        { name: 'console', message: 'Use o logger do pino.' },
      ],
    },
  },
  {
    // `lib/tokens.ts` é a única tradução de token para cor, e por isso o único
    // arquivo autorizado a escrever `var(--color-...)` e `color-mix`.
    files: ['apps/web/src/components/**/*.tsx', 'apps/web/src/views/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...NO_PROCESS_ENV, ...NO_LITERAL_COLOR],
    },
  },
  {
    // packages/env é a única fonte de process.env; os scripts de infra rodam fora do boot.
    files: [
      'packages/env/src/**/*.ts',
      'scripts/**/*.ts',
      '**/*.config.ts',
      'vitest.shared.ts',
    ],
    rules: { 'no-restricted-syntax': 'off', 'no-restricted-globals': 'off' },
  },
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/__tests__/**/*.ts',
      '**/src/testing/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
