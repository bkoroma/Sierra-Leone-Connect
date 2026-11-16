import globals from 'globals';
export default [{ ignores: ['**/vendor/**'] }, {
  files: ['**/*.js'], 
  languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.serviceworker } },
  rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-const-assign': 'error',
    'no-dupe-args': 'error', 'no-func-assign': 'error', 'no-self-assign': 'error', 'no-unsafe-optional-chaining': 'error', 'use-isnan': 'error', 'valid-typeof': 'error',
    'no-cond-assign': 'error', 'no-fallthrough': 'error', 'no-redeclare': 'error', 'no-shadow-restricted-names': 'error', 'no-unsafe-negation': 'error',
    'no-async-promise-executor': 'warn', 'no-constant-binary-expression': 'error', 'no-loss-of-precision': 'error', 'eqeqeq': ['warn', 'always', { null: 'ignore' }], 'require-atomic-updates': 'off' }
}];
