/* eslint-disable no-undef */
module.exports = {
  // preset: 'ts-jest/presets/default-esm', // Using custom transform instead
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    // Run the setup script before jsdom is initialized
    resources: 'usable',
    runScripts: 'dangerously',
    beforeParse(window) {
      // Use simple functions instead of jest.fn()
      const mockFn = () => {
        // Empty function for mock implementation
      };
      window.matchMedia =
        window.matchMedia ||
        (() => ({
          matches: false,
          media: '',
          onchange: null,
          addListener: mockFn, // deprecated
          removeListener: mockFn, // deprecated
          addEventListener: mockFn,
          removeEventListener: mockFn,
          dispatchEvent: mockFn,
        }));
    },
  },
  transform: {
    '^.+.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  moduleNameMapper: {
    // Simplified mappers for ESM packages
    '^@material/web/(.*)$': '<rootDir>/node_modules/@material/web/$1',
    '^lit$': '<rootDir>/node_modules/lit/index.js',
    '^lit/directives/(.*)$': '<rootDir>/node_modules/lit/directives/$1',
    // We remove more specific lit-* mappers as Jest might be able to resolve them itself
    // '^lit-element/(.*)$': '<rootDir>/node_modules/lit-element/$1',
    // '^lit-html/(.*)$': '<rootDir>/node_modules/lit-html/$1',
    // '^@lit/reactive-element/(.*)$': '<rootDir>/node_modules/@lit/reactive-element/$1',
  },
  transformIgnorePatterns: [
    // Allow transpilation of necessary ESM packages
    'node_modules/(?!(@lit|lit|@material/web)/)',
  ],
  extensionsToTreatAsEsm: ['.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts'],
};
