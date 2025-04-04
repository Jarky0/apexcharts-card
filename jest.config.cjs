module.exports = {
  // preset: 'ts-jest/presets/default-esm', // Using custom transform instead
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    // Führe das Setup-Skript aus, bevor jsdom initialisiert wird
    resources: 'usable',
    runScripts: 'dangerously',
    beforeParse(window) {
      // Verwende einfache Funktionen statt jest.fn()
      const mockFn = () => {};
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
    // Vereinfachte Mapper für ESM-Pakete
    '^@material/web/(.*)$': '<rootDir>/node_modules/@material/web/$1',
    '^lit$': '<rootDir>/node_modules/lit/index.js',
    '^lit/directives/(.*)$': '<rootDir>/node_modules/lit/directives/$1',
    // Wir entfernen spezifischere lit-* Mapper, da Jest sie vielleicht selbst auflösen kann
    // '^lit-element/(.*)$': '<rootDir>/node_modules/lit-element/$1',
    // '^lit-html/(.*)$': '<rootDir>/node_modules/lit-html/$1',
    // '^@lit/reactive-element/(.*)$': '<rootDir>/node_modules/@lit/reactive-element/$1',
  },
  transformIgnorePatterns: [
    // Erlaube Transpilierung der notwendigen ESM-Pakete
    'node_modules/(?!(@lit|lit|@material/web)/)',
  ],
  extensionsToTreatAsEsm: ['.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts'],
};
