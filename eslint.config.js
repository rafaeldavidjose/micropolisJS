import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/* The parts of the code style that a tool can check. The long dash is
 * checked in every file in scope by headless/dashes.ts. */
export default defineConfig([
  {
    files: ['headless/**/*.{ts,js}', 'eslint.config.js'],
    rules: {
      'no-var': 'error',
      'no-multi-spaces': 'error',
      'max-len': ['warn', { code: 80, ignoreUrls: true }],
      'id-length': ['error', { min: 2, exceptions: ['x', 'y'] }],
      'id-denylist': ['error', 'tmp', 'temp', 'res', 'ret', 'val', 'obj',
        'arr', 'str', 'num', 'cnt', 'idx', 'len', 'el', 'ev', 'evt', 'err',
        'cb', 'fn', 'ctx', 'foo', 'bar'],
      'multiline-comment-style': ['error', 'bare-block'],
      'padding-line-between-statements': ['error',
        { blankLine: 'always', prev: 'function', next: '*' },
        { blankLine: 'always', prev: '*', next: 'function' }],
    },
  },
  {
    files: ['headless/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/typedef': ['error', {
        arrayDestructuring: true,
        arrowParameter: true,
        memberVariableDeclaration: true,
        objectDestructuring: true,
        parameter: true,
        propertyDeclaration: true,
        variableDeclaration: true,
      }],
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowTypedFunctionExpressions: false,
        allowHigherOrderFunctions: false,
        allowDirectConstAssertionInArrowFunctions: false,
      }],
    },
  },
]);
