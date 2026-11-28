import { render } from '@solidjs/web';
import { createSignal, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VirtualList } from '../src/ui';
import type { VirtualListProps } from '../src/ui/VirtualList';
import { installResizeObserver } from './support/virtual-helpers';

let disposers: Array<() => void> = [];

interface ViewportMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop?: number;
}

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
  onRangeChange?: VirtualListProps['onRangeChange'];
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
          onRangeChange={options.onRangeChange}
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

  return { wrapper, scroller, scrollTo, notifyResize, ...controls };
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

it('reports null visibility for a hidden panel', () => {
  const onRangeChange = vi.fn();
  mountList({
    items: () => ['row'],
    metrics: { clientHeight: 600, scrollHeight: 1000 },
    panelDisplay: 'none',
    onRangeChange,
  });
  expect(onRangeChange).toHaveBeenLastCalledWith({ start: 0, end: -1 }, null);
});

it('reports strict viewport intersections even when overscan range stays the same', () => {
  const onRangeChange = vi.fn();
  const { scroller, setScrollTop } = mountList({
    items: () => ['first', 'second', 'third'],
    estimateSize: 100,
    metrics: { clientHeight: 100, scrollHeight: 300 },
    onRangeChange,
  });
  expect(onRangeChange).toHaveBeenLastCalledWith(
    { start: 0, end: 2 },
    { first: 0, last: 0 }
  );
  setScrollTop(2);
  scroller.dispatchEvent(new Event('scroll'));
  flush();
  expect(onRangeChange).toHaveBeenLastCalledWith(
    { start: 0, end: 2 },
    { first: 0, last: 1 }
  );
  setScrollTop(100);
  scroller.dispatchEvent(new Event('scroll'));
  flush();
  expect(onRangeChange).toHaveBeenLastCalledWith(
    { start: 0, end: 2 },
    { first: 1, last: 1 }
  );
});

it('keeps measured heights and rebuilds positions on an equal-length reorder', async () => {
  const [items, setItems] = createSignal(['short', 'tall']);
  const { scroller, notifyResize } = mountList({
    items,
    estimateSize: 100,
    metrics: { clientHeight: 320, scrollHeight: 320 },
  });
  await Promise.resolve();
  const short = scroller.querySelector<HTMLElement>('[data-index="0"]');
  const tall = scroller.querySelector<HTMLElement>('[data-index="1"]');
  if (short === null || tall === null) throw new Error('missing rows');

  notifyResize(short, 80);
  notifyResize(tall, 240);
  flush();
  const spacer = short.parentElement;
  expect(short.textContent).toBe('short');
  expect(tall.textContent).toBe('tall');
  expect(spacer?.style.height).toBe('320px');
  expect(tall.style.transform).toBe('translateY(80px)');

  setItems(['tall', 'short']);
  flush();
  expect(scroller.querySelector('[data-index="0"]')).toBe(tall);
  expect(scroller.querySelector('[data-index="1"]')).toBe(short);
  expect(spacer?.style.height).toBe('320px');
  expect(tall.style.transform).toBe('translateY(0px)');
  expect(short.style.transform).toBe('translateY(240px)');
});

it.each([
  { row: 1, offset: 272, expected: 306, position: 'above the fold' },
  { row: 2, offset: 280, expected: 280, position: 'spanning the fold' },
  { row: 3, offset: 280, expected: 280, position: 'below the fold' },
])(
  'handles upward-scroll remeasurement $position',
  async ({ row, offset, expected }) => {
    const { scroller, setScrollTop, scrollTo, notifyResize } = mountList({
      items: () => Array.from({ length: 15 }, (_, index) => `Row ${index}`),
      metrics: { clientHeight: 272, scrollHeight: 2040 },
    });
    const measured = scroller.querySelector<HTMLElement>(
      `[data-index="${row}"]`
    );
    if (measured === null) throw new Error('missing row');

    // jsdom reports zero height unless each rendered row gets a layout size.
    for (const element of scroller.querySelectorAll('[data-index]')) {
      Object.defineProperty(element, 'offsetHeight', { value: 136 });
    }

    await Promise.resolve();
    notifyResize(measured, 136);
    setScrollTop(360);
    scroller.dispatchEvent(new Event('scroll'));
    flush();
    setScrollTop(offset);
    scroller.dispatchEvent(new Event('scroll'));
    flush();
    scrollTo.mockClear();

    notifyResize(measured, 170);
    flush();

    expect(scroller.scrollTop).toBe(expected);
    expect(scrollTo).toHaveBeenCalledTimes(expected === offset ? 0 : 1);
    expect(measured.parentElement?.style.height).toBe('2074px');
  }
);

describe('VirtualList active row scroll stability', () => {
  it('does not jump back to the open article when appending rows while scrolled away', async () => {
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
    await Promise.resolve();

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});

describe('VirtualList deferred active index', () => {
  it('scrolls once when active index first becomes available after list load', async () => {
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
    await Promise.resolve();

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
