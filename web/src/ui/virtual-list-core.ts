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

const hiddenByStyle = (el: HTMLElement): boolean =>
  window.getComputedStyle(el).display === 'none';

/** `LIB-VIEW-1`: only panels visible via computed style and measured client height may paginate. */
const isVisible = (el: HTMLElement): boolean => {
  if (el.clientHeight <= 0) return false;

  let cur: HTMLElement | null = el;
  while (cur !== null) {
    if (hiddenByStyle(cur)) return false;
    cur = cur.parentElement;
  }

  return true;
};

/** End-of-list check using measured scroll geometry and computed panel visibility. */
const isEndReached = (
  el: HTMLDivElement | null,
  count: number,
  threshold: number
): boolean => {
  if (el === null || count === 0 || !isVisible(el)) return false;

  const viewport = el.clientHeight;
  const content = el.scrollHeight;
  if (viewport <= 0 || content <= 0) return false;
  if (content <= viewport) return true;

  return content - (el.scrollTop + viewport) <= threshold;
};

/**
 * Mutable mirror of the virtualizer measurements. Solid 2 reads lag writes
 * inside one flush, so effects read these synchronous values instead.
 */
class Mirrors {
  element: HTMLDivElement | null = null;
  estimate = DEFAULT_ESTIMATE_SIZE;
  overscan = DEFAULT_OVERSCAN;
  keys: ReadonlyArray<string> = [];
  triggered = -1;

  configure(
    estimate: number,
    overscan: number,
    keys: ReadonlyArray<string>
  ): void {
    this.estimate = estimate;
    this.overscan = overscan;
    this.keys = keys;
  }

  setElement(el: HTMLDivElement | null): void {
    this.element = el;
  }

  markTriggered(count: number): void {
    this.triggered = count;
  }
}

/** Reactive mirrors of the virtualizer measurements, updated on change. */
const useMeasurements = () => {
  const [rows, setRows] = createSignal<Array<VirtualItem>>([]);
  const [totalSize, setTotalSize] = createSignal(0);
  const [viewport, setViewport] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);

  const sync = (instance: ScrollVirtualizer) => {
    setRows(instance.getVirtualItems());
    setTotalSize(instance.getTotalSize());
    setViewport(instance.scrollRect?.height ?? 0);
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
  getItemKey: (index) => mirrors.keys[index] ?? index,
  observeElementRect,
  observeElementOffset,
  scrollToFn: elementScroll,
  onChange: sync,
});

interface VirtualizerInput {
  keys: () => ReadonlyArray<string>;
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
      keys: [...input.keys()],
      estimate: input.estimate(),
      overscan: input.overscan(),
      element: input.element(),
    }),
    (state) => {
      if (state.element === null) return;
      mirrors.setElement(state.element);
      mirrors.configure(state.estimate, state.overscan, state.keys);
      virtualizer.setOptions(optionsFor(state.keys.length, mirrors, sync));
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

const useEndReached = (input: EndReachedInput): (() => void) => {
  const { mirrors } = input;
  const reached = () =>
    isEndReached(mirrors.element, input.count(), input.threshold());

  const nearEnd = createMemo(() => {
    input.deps();
    return reached();
  });

  const trigger = (count: number): void => {
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
      if (near) trigger(count);
    }
  );

  return () => {
    if (reached()) trigger(input.count());
  };
};

const scrollHandler =
  (measurement: ReturnType<typeof useMeasurements>, check: () => void) =>
  (event: Event): void => {
    const el = event.currentTarget;
    if (!(el instanceof HTMLDivElement)) return;
    measurement.setScrollTop(el.scrollTop);
    check();
  };

export interface ListState {
  virtualizer: ScrollVirtualizer;
  rows: () => Array<VirtualItem>;
  totalSize: () => number;
  onScroll: (event: Event) => void;
  setScrollElement: (el: HTMLDivElement) => void;
}

export const useVirtualList = (props: VirtualListProps): ListState => {
  const mirrors = new Mirrors();
  const measurement = useMeasurements();
  const [element, setElement] = createSignal<HTMLDivElement | null>(null);
  const count = () => props.keys.length;

  const virtualizer = useVirtualizerCore(
    {
      keys: () => props.keys,
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

  return {
    virtualizer,
    rows: measurement.rows,
    totalSize: measurement.totalSize,
    onScroll: scrollHandler(measurement, check),
    setScrollElement: (el) => {
      mirrors.setElement(el);
      setElement(el);
    },
  };
};
