import { jest, beforeEach, afterEach } from '@jest/globals';

// Mock für window.matchMedia wurde nach jest.config.cjs verschoben

import '@material/web/ripple/ripple.js';

// Mock für Material Web Components
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

// Mock für Timer
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});
