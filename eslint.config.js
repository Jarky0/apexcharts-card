// eslint.config.js
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginLitA11y from 'eslint-plugin-lit-a11y';
import eslintRecommended from '@eslint/js'; // Import recommended JS rules

export default tseslint.config(
  // Global ignores
  {
    ignores: ['node_modules/', 'dist/', 'build/'],
  },

  // Apply ESLint recommended rules globally
  eslintRecommended.configs.recommended,

  // Base configurations for all TypeScript files
  {
    files: ['src/**/*.ts'],
    extends: [
      // Use predefined configs from typescript-eslint
      ...tseslint.configs.recommended, // Basic TS rules
      // ...tseslint.configs.recommendedTypeChecked, // Stricter rules requiring type info (optional)
      // ...tseslint.configs.stylistic, // Stylistic rules (optional)
    ],
    languageOptions: {
      parserOptions: {
        project: true, // Automatically find tsconfig.json
        tsconfigRootDir: import.meta.dirname, // Set root for tsconfig discovery
      },
      // Explicitly add globals if needed beyond recommended configs
      globals: {
        // ...globals.browser, // Keep browser globals for now - REMOVED
        // ...globals.node,    // Keep node globals for now - REMOVED
      },
    },
    plugins: {
      // Plugins are often implicitly handled by extends in tseslint v9+
      // Ensure lit-a11y plugin is correctly configured if not covered by extends:
      'lit-a11y': pluginLitA11y,
    },
    rules: {
      // Include recommended lit-a11y rules here
      ...pluginLitA11y.configs.recommended.rules,

      // Custom rules from old .eslintrc.json
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
    },
  },

  // Overrides for test files
  {
    files: ['src/__tests__/**/*.ts'],
    // Specific settings or rule overrides for tests
    extends: [tseslint.configs.disableTypeChecked], // Remove spread operator here
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-undef': 'off',
    },
  },
);
