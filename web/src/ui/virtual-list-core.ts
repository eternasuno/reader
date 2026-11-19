import type { VirtualItem, VirtualizerOptions } from '@tanstack/virtual-core';
import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  Virtualizer,
} from '@tanstack/virtual-core';
import { createEffect, createMemo, createSignal, onSettled } from 'solid-js';
import type { VirtualListProps } from './VirtualList';

export const DEFAULT_ESTIMATE_SIZE = 96;
export const DEFAULT_OVERSCAN = 6;
export const DEFAULT_END_THRESHOLD = 600;

export type ScrollVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>;
type ScrollOptions = VirtualizerOptions<HTMLDivElement, HTMLDivElement>;

const hiddenByStyle = (el: HTMLElement): boolean => {
  if (typeof window === 'undefined') return false;
  if (typeof window.getComputedStyle !== 'function') return false;
  return window.getComputedStyle(el).display === 'none';
};

/** `LIB-VIEW-1`: a scroll container inside a CSS-hidden panel must never request more rows. */
const isHidden = (el: HTMLElement): boolean => {
  let cur: HTMLElement | null = el;
  while (cur !== null) {
    if (cur.classList.contains('hidden')) return true;
    if (hiddenByStyle(cur)) return true;
    cur = cur.parentElement;
  }

  return false;
};

/** JSDOM (and hidden panels) report no geometry; only real scrolls may page. */
const mayPage = (el: HTMLDivElement, fromScroll: boolean): boolean => {
  if (isHidden(el)) return false;
  return fromScroll || el.clientHeight !== 0 || el.scrollHeight !== 0;
};

/** End-of-list test; a zero-height viewport counts as "at the end". */
const isEndReached = (
  mirrors: Mirrors,
  count: number,
  threshold: number
): boolean => {
  if (mirrors.element === null || count === 0 || !mirrors.measured) {
    return false;
  }
  const content = Math.max(mirrors.content, count * mirrors.estimate);
  const viewport = mirrors.viewport;
  if (viewport <= 0 || content <= viewport) return true;
  return content - (mirrors.offset + viewport) <= threshold;
};

/**
 * Mutable mirror of the virtualizer measurements. Solid 2 reads lag writes
 * inside one flush, so effects read these synchronous values instead.
 */
class Mirrors {
  element: HTMLDivElement | null = null;
  content = 0;
  viewport = 0;
  offset = 0;
  estimate = DEFAULT_ESTIMATE_SIZE;
  overscan = DEFAULT_OVERSCAN;
  measured = false;
  triggered = -1;

  sync(instance: ScrollVirtualizer): void {
    this.content = instance.getTotalSize();
    this.viewport = instance.scrollRect?.height ?? 0;
    this.measured = true;
  }

  configure(estimate: number, overscan: number): void {
    this.estimate = estimate;
    this.overscan = overscan;
  }

  setElement(el: HTMLDivElement | null): void {
    this.element = el;
  }

  scrolled(el: HTMLDivElement): void {
    this.offset = el.scrollTop;
    this.viewport = el.clientHeight;
  }

  markTriggered(count: number): void {
    this.triggered = count;
  }
}

/** Reactive mirrors of the virtualizer measurements, updated on change. */
const useMeasurements = (mirrors: Mirrors) => {
  const [rows, setRows] = createSignal<Array<VirtualItem>>([]);
  const [totalSize, setTotalSize] = createSignal(0);
  const [viewport, setViewport] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);

  const sync = (instance: ScrollVirtualizer) => {
    mirrors.sync(instance);
    setRows(instance.getVirtualItems());
    setTotalSize(mirrors.content);
    setViewport(mirrors.viewport);
  };

  return { rows, totalSize, viewport, scrollTop, setScrollTop, sync };
};

const optionsFor = (
  count: number,
  mirrors: Mirrors,
  sync: (instance: ScrollVirtualizer) => void
): ScrollOptions => ({
  count,
  getScrollElement: () => mirrors.element,
  estimateSize: () => mirrors.estimate,
  overscan: mirrors.overscan,
  observeElementRect,
  observeElementOffset,
  scrollToFn: elementScroll,
  onChange: sync,
});

interface VirtualizerInput {
  count: () => number;
  estimate: () => number;
  overscan: () => number;
  element: () => HTMLDivElement | null;
}

/** Creates the `@tanstack/virtual-core` instance and re-applies its options. */
const useVirtualizerCore = (
  input: VirtualizerInput,
  mirrors: Mirrors,
  measurement: ReturnType<typeof useMeasurements>
): ScrollVirtualizer => {
  const { sync } = measurement;
  const virtualizer: ScrollVirtualizer = new Virtualizer(
    optionsFor(0, mirrors, sync)
  );

  onSettled(() => virtualizer._didMount());

  createEffect(
    () => ({
      count: input.count(),
      estimate: input.estimate(),
      overscan: input.overscan(),
      element: input.element(),
    }),
    (state) => {
      if (state.element === null) return;
      mirrors.setElement(state.element);
      mirrors.configure(state.estimate, state.overscan);
      virtualizer.setOptions(optionsFor(state.count, mirrors, sync));
      virtualizer._willUpdate();
      sync(virtualizer);
    }
  );

  return virtualizer;
};

interface EndReachedInput {
  mirrors: Mirrors;
  count: () => number;
  threshold: () => number;
  /** Reactive sources that must re-run the end check. */
  deps: () => unknown;
  onEndReached: () => void;
}

const useEndReached = (
  input: EndReachedInput
): ((fromScroll: boolean) => void) => {
  const { mirrors } = input;
  const reached = () => isEndReached(mirrors, input.count(), input.threshold());

  const nearEnd = createMemo(() => {
    input.deps();
    return reached();
  });

  const check = (fromScroll: boolean): void => {
    const el = mirrors.element;
    if (el === null || !mayPage(el, fromScroll) || !reached()) return;

    const count = input.count();
    if (count === 0 || count === mirrors.triggered) return;
    mirrors.markTriggered(count);
    input.onEndReached();
  };

  createEffect(
    () => ({ near: nearEnd(), count: input.count() }),
    ({ near, count }) => {
      if (count === 0) {
        mirrors.markTriggered(-1);
        return;
      }
      if (near) check(false);
    }
  );

  return check;
};

/**
 * JSDOM (and hidden panels) report a zero-height viewport. Render every row so
 * DOM tests can inspect the list, and so nothing silently disappears.
 */
const useFallbackVisible = (
  count: () => number,
  rows: () => Array<VirtualItem>,
  viewport: () => number,
  element: () => HTMLDivElement | null
): (() => boolean) =>
  createMemo(() => {
    if (count() === 0) return false;
    if (element() === null) return true;
    if (rows().length === 0) return true;
    return viewport() === 0;
  });

const scrollHandler =
  (
    mirrors: Mirrors,
    measurement: ReturnType<typeof useMeasurements>,
    check: (fromScroll: boolean) => void
  ) =>
  (event: Event): void => {
    const el = event.currentTarget;
    if (!(el instanceof HTMLDivElement)) return;
    mirrors.scrolled(el);
    measurement.setScrollTop(mirrors.offset);
    check(true);
  };

export interface ListState {
  virtualizer: ScrollVirtualizer;
  rows: () => Array<VirtualItem>;
  totalSize: () => number;
  fallbackVisible: () => boolean;
  onScroll: (event: Event) => void;
  setScrollElement: (el: HTMLDivElement) => void;
}

export const useVirtualList = <T>(props: VirtualListProps<T>): ListState => {
  const mirrors = new Mirrors();
  const measurement = useMeasurements(mirrors);
  const [element, setElement] = createSignal<HTMLDivElement | null>(null);
  const count = () => props.items.length;

  const virtualizer = useVirtualizerCore(
    {
      count,
      estimate: () => props.estimateSize ?? DEFAULT_ESTIMATE_SIZE,
      overscan: () => props.overscan ?? DEFAULT_OVERSCAN,
      element,
    },
    mirrors,
    measurement
  );

  const check = useEndReached({
    mirrors,
    count,
    threshold: () => props.endReachedThreshold ?? DEFAULT_END_THRESHOLD,
    deps: () => [
      element(),
      measurement.totalSize(),
      measurement.viewport(),
      measurement.scrollTop(),
    ],
    onEndReached: () => props.onEndReached?.(),
  });

  const fallbackVisible = useFallbackVisible(
    count,
    measurement.rows,
    measurement.viewport,
    element
  );

  return {
    virtualizer,
    rows: measurement.rows,
    totalSize: measurement.totalSize,
    fallbackVisible,
    onScroll: scrollHandler(mirrors, measurement, check),
    setScrollElement: (el) => {
      mirrors.setElement(el);
      setElement(el);
    },
  };
};
