import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env']",
          message:
            'Só packages/env lê process.env. Importe `environment` de @patrimonio/env.',
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Só packages/env lê process.env. Importe `environment` de @patrimonio/env.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'console', message: 'Use o logger do pino.' },
      ],
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
    files: ['**/*.test.ts', '**/__tests__/**/*.ts', '**/src/testing/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
