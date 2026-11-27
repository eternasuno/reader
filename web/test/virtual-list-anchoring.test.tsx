import { render } from '@solidjs/web';
import { createSignal, flush } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { VirtualList } from '../src/ui';
import { installResizeObserver } from './support/virtual-helpers';

const ROW_HEIGHT = 100;
const VIEWPORT_HEIGHT = 150;
let dispose: (() => void) | undefined;

const mountList = (options: {
  items: () => ReadonlyArray<string>;
  activeKey?: () => string | null;
  activeIndex?: () => number;
}) => {
  const notifyResize = installResizeObserver();
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(
    ROW_HEIGHT
  );
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(
    () => (
      <VirtualList
        keys={options.items()}
        estimateSize={ROW_HEIGHT}
        activeKey={options.activeKey?.()}
        activeIndex={options.activeIndex?.()}
        renderItem={(key) => <div>{key}</div>}
      />
    ),
    host
  );
  flush();
  const scroller = host.querySelector<HTMLDivElement>('.overflow-y-auto');
  if (scroller === null) throw new Error('missing scroller');

  Object.defineProperties(scroller, {
    clientHeight: { get: () => VIEWPORT_HEIGHT },
    scrollHeight: {
      get: () =>
        Number.parseFloat(
          scroller.querySelector<HTMLElement>(':scope > div')?.style.height ??
            '0'
        ),
    },
  });
  const scrollTo = vi.fn((opts: ScrollToOptions) => {
    scroller.scrollTop = Math.max(
      0,
      Math.min(opts.top ?? 0, scroller.scrollHeight - scroller.clientHeight)
    );
  });
  Object.defineProperty(scroller, 'scrollTo', { value: scrollTo });
  notifyResize(scroller, VIEWPORT_HEIGHT);
  flush();

  return { scroller, scrollTo };
};

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  {
    change: 'removing a row above',
    keys: ['a', 'c', 'd', 'e', 'f'],
    visible: 'c',
    offset: -25,
    scrollTop: 125,
  },
  {
    change: 'inserting rows above near the old scroll limit',
    keys: ['x', 'y', 'z', 'a', 'b', 'c', 'd', 'e', 'f'],
    visible: 'c',
    offset: -25,
    scrollTop: 525,
  },
  {
    change: 'removing the anchor',
    keys: ['a', 'b', 'd', 'e', 'f'],
    visible: 'd',
    offset: 75,
    scrollTop: 125,
  },
  {
    change: 'removing all visible rows',
    keys: ['b', 'e', 'f'],
    visible: 'b',
    offset: 0,
    scrollTop: 0,
  },
  {
    change: 'using the nearest surviving predecessor',
    keys: ['a', 'b', 'e', 'f'],
    visible: 'b',
    offset: 0,
    scrollTop: 100,
  },
  {
    change: 'removing all visible and preceding rows',
    keys: ['x', 'y', 'z', 'e', 'f'],
    visible: 'x',
    offset: 0,
    scrollTop: 0,
  },
])(
  'keeps the expected viewport position after $change',
  async ({ keys, visible, offset, scrollTop }) => {
    const [items, setItems] = createSignal(['a', 'b', 'c', 'd', 'e', 'f']);
    const { scroller, scrollTo } = mountList({
      items,
    });
    scroller.scrollTop = 225;
    scroller.dispatchEvent(new Event('scroll'));
    flush();

    setItems(keys);
    flush();
    await Promise.resolve();
    flush();

    expect(scroller.scrollTop).toBe(scrollTop);
    scroller.dispatchEvent(new Event('scroll'));
    flush();
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: scrollTop,
      behavior: 'instant',
    });
    const row = scroller.querySelector<HTMLElement>(
      `[data-index="${keys.indexOf(visible)}"]`
    );
    expect(row?.textContent).toBe(visible);
    expect(row?.style.transform).toBe(`translateY(${scrollTop + offset}px)`);
  }
);

it('keeps the viewport at the top when rows are prepended within one pixel of the top', async () => {
  const [items, setItems] = createSignal(['a', 'b', 'c', 'd']);
  const { scroller, scrollTo } = mountList({
    items,
  });
  scroller.scrollTop = 1;
  scroller.dispatchEvent(new Event('scroll'));
  flush();

  setItems(['x', ...items()]);
  flush();
  await Promise.resolve();
  flush();

  expect(scroller.scrollTop).toBeLessThanOrEqual(1);
  expect(scrollTo).not.toHaveBeenCalled();
  expect(scroller.querySelector('[data-index="0"]')?.textContent).toBe('x');
});

it('defers an iOS membership adjustment until the scroll settles', async () => {
  vi.useFakeTimers();
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
  const [items, setItems] = createSignal(['a', 'b', 'c', 'd', 'e', 'f']);
  const { scroller, scrollTo } = mountList({ items });
  try {
    scroller.scrollTop = 225;
    scroller.dispatchEvent(new Event('scroll'));
    flush();

    setItems(['a', 'c', 'd', 'e', 'f']);
    flush();
    await Promise.resolve();
    expect(scrollTo).not.toHaveBeenCalled();

    scroller.scrollTop = 250;
    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(150);
    await Promise.resolve();

    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 150,
      behavior: 'instant',
    });
  } finally {
    vi.useRealTimers();
  }
});

it('scrolls only to the selection when membership and selection change together', async () => {
  const [items, setItems] = createSignal(['a', 'b', 'c', 'd', 'e', 'f']);
  const [activeKey, setActiveKey] = createSignal<string | null>(null);
  const { scroller, scrollTo } = mountList({
    items,
    activeKey,
    activeIndex: () => items().indexOf(activeKey() ?? ''),
  });
  scroller.scrollTop = 225;
  scroller.dispatchEvent(new Event('scroll'));
  flush();

  setItems(['x', 'y', 'z', ...items()]);
  setActiveKey('f');
  flush();
  await Promise.resolve();
  flush();

  expect(scroller.scrollTop).toBe(750);
  expect(scrollTo).toHaveBeenCalledTimes(1);
});
