 
 
import { MdRipple } from '@material/web/ripple/ripple.js';
import { noChange } from 'lit';
import { AttributePart, directive, Directive, DirectiveParameters } from 'lit/directive.js';
import { fireEvent } from './fire-event';
import { deepEqual } from './deep-equal';
import { ActionHandlerOptions } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || (navigator as any).msMaxTouchPoints > 0;

export interface ActionHandlerInterface extends HTMLElement {
  holdTime: number;
  bind(element: Element, options?: ActionHandlerOptions): void;
}

interface ActionHandlerElement extends HTMLElement {
  actionHandler?: {
    options: ActionHandlerOptions;
    start?: (ev: Event) => void;
    end?: (ev: Event) => void;
    handleEnter?: (ev: KeyboardEvent) => void;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'apexcharts-card-action-handler': ActionHandler;
  }
}

export class ActionHandler extends HTMLElement implements ActionHandlerInterface {
  public holdTime = 500;

  public ripple: MdRipple;

  protected timer?: number;

  protected held = false;

  private cancelled = false;

  private dblClickTimeout?: number;

  constructor() {
    super();
    this.ripple = document.createElement('md-ripple') as MdRipple;
  }

  public connectedCallback() {
    Object.assign(this.style, {
      position: 'fixed',
      width: isTouch ? '100px' : '50px',
      height: isTouch ? '100px' : '50px',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      zIndex: '999',
    });

    this.appendChild(this.ripple);

    ['touchcancel', 'mouseout', 'mouseup', 'touchmove', 'mousewheel', 'wheel', 'scroll'].forEach((ev) => {
      document.addEventListener(
        ev,
        () => {
          this.cancelled = true;
          if (this.timer) {
            this.stopAnimation();
            clearTimeout(this.timer);
            this.timer = undefined;
          }
        },
        { passive: true },
      );
    });
  }

  public bind(element: ActionHandlerElement, options: ActionHandlerOptions = {}) {
    if (element.actionHandler && deepEqual(options, element.actionHandler.options)) {
      return;
    }

    if (element.actionHandler) {
      element.removeEventListener('touchstart', element.actionHandler.start!);
      element.removeEventListener('touchend', element.actionHandler.end!);
      element.removeEventListener('touchcancel', element.actionHandler.end!);

      element.removeEventListener('mousedown', element.actionHandler.start!);
      element.removeEventListener('click', element.actionHandler.end!);

      element.removeEventListener('keyup', element.actionHandler.handleEnter!);
    } else {
      element.addEventListener('contextmenu', (ev: Event) => {
        const e = ev || window.event;
        if (e.preventDefault) {
          e.preventDefault();
        }
        if (e.stopPropagation) {
          e.stopPropagation();
        }
        e.cancelBubble = true;
        e.returnValue = false;
        return false;
      });
    }

    element.actionHandler = { options };

    if (options.disabled) {
      return;
    }

    element.actionHandler.start = (ev: Event) => {
      this.cancelled = false;
      let x;
      let y;
      if ((ev as TouchEvent).touches) {
        x = (ev as TouchEvent).touches[0].clientX;
        y = (ev as TouchEvent).touches[0].clientY;
      } else {
        x = (ev as MouseEvent).clientX;
        y = (ev as MouseEvent).clientY;
      }

      if (options.hasHold) {
        this.held = false;
        this.timer = window.setTimeout(() => {
          this.startAnimation(x, y);
          this.held = true;
        }, this.holdTime);
      }
    };

    element.actionHandler.end = (ev: Event) => {
      // Don't respond when moved or scrolled while touch
      if (['touchend', 'touchcancel'].includes(ev.type) && this.cancelled) {
        return;
      }
      const target = ev.target as HTMLElement;
      // Prevent mouse event if touch event
      if (ev.cancelable) {
        ev.preventDefault();
      }
      if (options.hasHold) {
        clearTimeout(this.timer);
        this.stopAnimation();
        this.timer = undefined;
      }
      if (options.hasHold && this.held) {
        fireEvent(target, 'action', { action: 'hold' });
      } else if (options.hasDoubleClick) {
        if ((ev.type === 'click' && (ev as MouseEvent).detail < 2) || !this.dblClickTimeout) {
          this.dblClickTimeout = window.setTimeout(() => {
            this.dblClickTimeout = undefined;
            fireEvent(target, 'action', { action: 'tap' });
          }, 250);
        } else {
          clearTimeout(this.dblClickTimeout);
          this.dblClickTimeout = undefined;
          fireEvent(target, 'action', { action: 'double_tap' });
        }
      } else {
        fireEvent(target, 'action', { action: 'tap' });
      }
    };

    element.actionHandler.handleEnter = (ev: KeyboardEvent) => {
      if (ev.keyCode !== 13) {
        return;
      }
      (ev.currentTarget as ActionHandlerElement).actionHandler!.end!(ev);
    };

    element.addEventListener('touchstart', element.actionHandler.start, {
      passive: true,
    });
    element.addEventListener('touchend', element.actionHandler.end);
    element.addEventListener('touchcancel', element.actionHandler.end);

    element.addEventListener('mousedown', element.actionHandler.start, {
      passive: true,
    });
    element.addEventListener('click', element.actionHandler.end);

    element.addEventListener('keyup', element.actionHandler.handleEnter);
  }

  private startAnimation(x: number, y: number) {
    Object.assign(this.style, {
      left: `${x}px`,
      top: `${y}px`,
      display: null,
    });
    this.ripple.disabled = false;
    this.ripple.attach(this);
  }

  private stopAnimation() {
    this.ripple.detach();
    this.ripple.disabled = true;
    this.style.display = 'none';
  }
}

customElements.define('apexcharts-card-action-handler', ActionHandler);

const getActionHandler = (): ActionHandler => {
  const body = document.body;
  if (body.querySelector('apexcharts-card-action-handler')) {
    return body.querySelector('apexcharts-card-action-handler') as ActionHandler;
  }

  const actionhandler = document.createElement('apexcharts-card-action-handler');
  body.appendChild(actionhandler);

  return actionhandler as ActionHandler;
};

 
export const actionHandlerBind = (element: ActionHandlerElement, options?: ActionHandlerOptions) => {
  const actionhandler: ActionHandler = getActionHandler();
  if (!actionhandler) {
    return;
  }
  actionhandler.bind(element, options);
};

export const actionHandler = directive(
  class extends Directive {
    update(part: AttributePart, [options]: DirectiveParameters<this>) {
      actionHandlerBind(part.element as ActionHandlerElement, options);
      return noChange;
    }

     
    render(_options?: ActionHandlerOptions) {}
  },
);
