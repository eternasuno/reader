import { vi } from 'vitest';

export const installResizeObserver = () => {
  const callbacks = new Map<Element, ResizeObserverCallback>();

  class MockResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element): void {
      callbacks.set(target, this.callback);
    }

    unobserve(target: Element): void {
      callbacks.delete(target);
    }

    disconnect(): void {
      callbacks.clear();
    }
  }

  vi.stubGlobal('ResizeObserver', MockResizeObserver);

  return (target: Element, height: number): void => {
    const callback = callbacks.get(target);
    if (callback === undefined) return;
    callback(
      [
        {
          target,
          contentRect: { width: 320, height } as DOMRectReadOnly,
          borderBoxSize: [
            { inlineSize: 320, blockSize: height },
          ] as unknown as ReadonlyArray<ResizeObserverSize>,
          contentBoxSize: [
            { inlineSize: 320, blockSize: height },
          ] as unknown as ReadonlyArray<ResizeObserverSize>,
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver
    );
  };
};

export const sizeScroller = (
  scroller: HTMLDivElement,
  height: number
): void => {
  Object.defineProperty(scroller, 'clientHeight', {
    configurable: true,
    get: () => height,
  });
  Object.defineProperty(scroller, 'scrollHeight', {
    configurable: true,
    get: () => height * 2,
  });
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => 0,
    set: () => undefined,
  });
  Object.defineProperty(scroller, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        width: 320,
        height,
        top: 0,
        left: 0,
        right: 320,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  });
};
