import { render } from '@solidjs/web';
import { createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VirtualList } from '../src/ui';

let disposers: Array<() => void> = [];

interface ViewportMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop?: number;
}

const installResizeObserver = () => {
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

  return (target: Element, height: number) => {
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

const applyViewportMetrics = (
  scroller: HTMLDivElement,
  metrics: ViewportMetrics
): { setScrollTop: (next: number) => void } => {
  let scrollTop = metrics.scrollTop ?? 0;

  Object.defineProperty(scroller, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(scroller, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  Object.defineProperty(scroller, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        width: 320,
        height: metrics.clientHeight,
        top: 0,
        left: 0,
        right: 320,
        bottom: metrics.clientHeight,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  });

  return {
    setScrollTop: (next: number) => {
      scrollTop = next;
    },
  };
};

const mountList = (options: {
  items: () => Array<string>;
  estimateSize?: number;
  metrics: ViewportMetrics;
  panelClass?: string;
  panelDisplay?: string;
  onEndReached?: () => void;
  activeKey?: () => string | null;
  activeIndex?: () => number;
}) => {
  const notifyResize = installResizeObserver();
  const wrapper = document.createElement('div');
  if (options.panelClass !== undefined) wrapper.className = options.panelClass;
  if (options.panelDisplay !== undefined) {
    wrapper.style.display = options.panelDisplay;
  }
  document.body.append(wrapper);

  disposers.push(
    render(
      () => (
        <VirtualList
          keys={options.items()}
          estimateSize={options.estimateSize ?? 136}
          onEndReached={options.onEndReached}
          activeKey={options.activeKey?.()}
          activeIndex={options.activeIndex?.()}
          renderItem={(key) => <div>{key}</div>}
        />
      ),
      wrapper
    )
  );
  flush();

  const scroller = wrapper.querySelector(
    '.overflow-y-auto'
  ) as HTMLDivElement | null;
  if (scroller === null) throw new Error('missing scroller');
  const controls = applyViewportMetrics(scroller, options.metrics);
  const scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
    if (typeof opts === 'object' && opts !== null && opts.top !== undefined) {
      controls.setScrollTop(opts.top);
    }
  });
  Object.defineProperty(scroller, 'scrollTo', {
    configurable: true,
    value: scrollTo,
  });
  notifyResize(scroller, options.metrics.clientHeight);
  flush();

  return { wrapper, scroller, scrollTo, ...controls };
};

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('VirtualList visibility and virtualization', () => {
  it('renders only windowed virtual rows with explicit viewport measurements', () => {
    const [items] = createSignal(
      Array.from({ length: 50 }, (_, index) => `Row ${index}`)
    );
    const { scroller } = mountList({
      items,
      estimateSize: 100,
      metrics: { clientHeight: 400, scrollHeight: 5000 },
    });

    const rendered = scroller.querySelectorAll('[data-index]');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(20);
  });

  it('does not render fallback static rows when viewport height is zero or hidden', () => {
    const [items] = createSignal(
      Array.from({ length: 10 }, (_, index) => `Row ${index}`)
    );
    const { scroller } = mountList({
      items,
      metrics: { clientHeight: 0, scrollHeight: 0 },
      panelDisplay: 'none',
    });

    expect(scroller.querySelectorAll('[data-index]')).toHaveLength(0);
  });
});

describe('VirtualList hidden panel pagination guard', () => {
  it('does not paginate when computed display is none', () => {
    const onEndReached = vi.fn();
    const [items] = createSignal(
      Array.from({ length: 30 }, (_, index) => `Row ${index}`)
    );
    const { scroller, setScrollTop } = mountList({
      items,
      metrics: { clientHeight: 600, scrollHeight: 1000 },
      panelClass: 'hidden lg:flex',
      panelDisplay: 'none',
      onEndReached,
    });

    setScrollTop(400);
    scroller.dispatchEvent(new Event('scroll'));
    flush();

    expect(onEndReached).not.toHaveBeenCalled();
  });
});

describe('VirtualList measured scroll geometry threshold', () => {
  it('uses measured scrollHeight instead of count * estimate for the 600px threshold', () => {
    const onEndReached = vi.fn();
    const [items] = createSignal(
      Array.from({ length: 30 }, (_, index) => `Row ${index}`)
    );
    const { scroller, setScrollTop } = mountList({
      items,
      estimateSize: 136,
      metrics: { clientHeight: 600, scrollHeight: 1500 },
      panelDisplay: 'flex',
      onEndReached,
    });

    expect(onEndReached).not.toHaveBeenCalled();

    setScrollTop(300);
    scroller.dispatchEvent(new Event('scroll'));
    flush();

    expect(onEndReached).toHaveBeenCalledTimes(1);
  });
});

describe('VirtualList active row scroll stability', () => {
  it('does not jump back to the open article when appending rows while scrolled away', () => {
    const [items, setItems] = createSignal(
      Array.from({ length: 30 }, (_, index) => `Row ${index}`)
    );
    const [activeId, setActiveId] = createSignal<string | null>('Row 2');

    const { scroller, scrollTo, setScrollTop } = mountList({
      items,
      estimateSize: 100,
      metrics: { clientHeight: 500, scrollHeight: 3000 },
      panelDisplay: 'flex',
      activeKey: activeId,
      activeIndex: () => {
        const key = activeId();
        return key === null ? -1 : items().indexOf(key);
      },
    });

    scrollTo.mockClear();
    setScrollTop(2000);
    scroller.dispatchEvent(new Event('scroll'));
    flush();

    setItems(Array.from({ length: 60 }, (_, index) => `Row ${index}`));
    flush();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(2000);

    setActiveId('Row 50');
    flush();

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});

describe('VirtualList deferred active index', () => {
  it('scrolls once when active index first becomes available after list load', () => {
    const [items, setItems] = createSignal<Array<string>>([]);
    const [activeId] = createSignal<string | null>('Row 25');

    const { scroller, scrollTo, setScrollTop } = mountList({
      items,
      estimateSize: 100,
      metrics: { clientHeight: 500, scrollHeight: 3000 },
      panelDisplay: 'flex',
      activeKey: activeId,
      activeIndex: () => {
        const key = activeId();
        return key === null ? -1 : items().indexOf(key);
      },
    });

    expect(scrollTo).not.toHaveBeenCalled();

    setItems(Array.from({ length: 30 }, (_, index) => `Row ${index}`));
    flush();

    expect(scrollTo).toHaveBeenCalledTimes(1);

    scrollTo.mockClear();
    setScrollTop(0);
    scroller.dispatchEvent(new Event('scroll'));
    flush();

    setItems(Array.from({ length: 60 }, (_, index) => `Row ${index}`));
    flush();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(0);
  });
});
