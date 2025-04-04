import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { ActionHandler } from '../action-handler-directive';

describe('ActionHandler', () => {
  let actionHandler: ActionHandler;
  let mockElement: HTMLElement;

  beforeEach(() => {
    actionHandler = new ActionHandler();
    mockElement = document.createElement('div');
    document.body.appendChild(actionHandler);
  });

  afterEach(() => {
    document.body.removeChild(actionHandler);
  });

  it('should initialize ripple component', () => {
    expect(actionHandler.ripple).toBeDefined();
    expect(actionHandler.ripple.disabled).toBe(false);
  });

  it('should handle touch events correctly', () => {
    const options = {
      hasHold: true,
      hasDoubleClick: false,
    };

    // Mock event listener
    const actionListener = jest.fn();
    mockElement.addEventListener('action', actionListener);

    actionHandler.bind(mockElement, options);

    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 100, clientY: 100 } as Touch],
    });

    mockElement.dispatchEvent(touchStart);

    // Wait for the hold timer
    jest.advanceTimersByTime(500);

    const touchEnd = new TouchEvent('touchend');
    mockElement.dispatchEvent(touchEnd);

    // Verify hold action was fired
    expect(actionListener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { action: 'hold' },
      }),
    );
  });

  it('should handle double click events correctly', () => {
    const options = {
      hasHold: false,
      hasDoubleClick: true,
    };

    actionHandler.bind(mockElement, options);

    // Mock event listener
    const actionListener = jest.fn();
    mockElement.addEventListener('action', actionListener);

    // Simulate first click (detail: 1)
    mockElement.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    // Simulate second click within 250ms (detail: 2)
    jest.advanceTimersByTime(100);
    mockElement.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));

    // Verify double tap action was fired
    expect(actionListener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { action: 'double_tap' },
      }),
    );
  });
});
