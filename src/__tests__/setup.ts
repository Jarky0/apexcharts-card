import { jest, beforeEach, afterEach } from '@jest/globals';

// Mock for window.matchMedia was moved to jest.config.cjs

import '@material/web/ripple/ripple.js';

// Mock for Material Web Components
jest.mock('@material/web/ripple/ripple.js', () => {
  return {
    MdRipple: class {
      disabled = true;
      attach() {
        // no-op
      }
      detach() {
        // no-op
      }
    },
  };
});

// Mock for Timer
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});
