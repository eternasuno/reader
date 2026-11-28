import type { VirtualItem, VirtualizerOptions } from '@tanstack/virtual-core';
import {
  elementScroll,
  measureElement,
  observeElementOffset,
  observeElementRect,
  Virtualizer,
} from '@tanstack/virtual-core';
import { createSignal, onCleanup, onSettled } from 'solid-js';
import type { VirtualListProps } from './VirtualList';

const DEFAULT_ESTIMATE_SIZE = 96;
const DEFAULT_OVERSCAN = 6;

export type ScrollVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>;
export type SyncViewport = (
  instance: ScrollVirtualizer,
  offset?: number
) => void;

type ScrollOptions = VirtualizerOptions<HTMLDivElement, HTMLDivElement>;

type ListOptions = {
  keys: ReadonlyArray<string>;
  estimate: VirtualListProps['estimateSize'];
  overscan: number | undefined;
  element: HTMLDivElement;
};

const makeOptions = (
  getScrollElement: ScrollOptions['getScrollElement'],
  estimateSize: ScrollOptions['estimateSize'],
  sync: SyncViewport,
  onScrollEnd: () => void,
  scrollToFn: ScrollOptions['scrollToFn']
): ScrollOptions => ({
  count: 0,
  getScrollElement,
  estimateSize,
  observeElementRect: (instance, notify) =>
    observeElementRect(instance, (rect) => {
      notify(rect);
      sync(instance);
    }),
  observeElementOffset: (instance, notify) =>
    observeElementOffset(instance, (offset, scrolling) => {
      notify(offset, scrolling);
      sync(instance, offset);
      if (!scrolling) onScrollEnd();
    }),
  scrollToFn,
  onChange: (instance) => sync(instance),
});

const trackRowMeasurements = (estimateSize: ScrollOptions['estimateSize']) => {
  let measuredAtEstimate = new WeakSet<HTMLDivElement>();

  const shouldAdjustScrollPositionOnItemSizeChange: NonNullable<
    ScrollVirtualizer['shouldAdjustScrollPositionOnItemSizeChange']
  > = (item, _delta, instance) => {
    const offset = instance.scrollOffset ?? 0;
    const measuredSize = instance.itemSizeCache.get(item.key);
    if (measuredSize !== undefined) return item.start + measuredSize <= offset;

    const element = instance.elementsCache.get(item.key);
    if (element !== undefined && measuredAtEstimate.has(element)) {
      return item.end <= offset;
    }

    return item.start < offset;
  };

  const measure: NonNullable<ScrollOptions['measureElement']> = (
    element,
    entry,
    instance
  ) => {
    const size = measureElement(element, entry, instance);
    // TanStack leaves equal-to-estimate measurements out of its size cache.
    if (size === estimateSize(instance.indexFromElement(element))) {
      measuredAtEstimate.add(element);
    }

    return size;
  };
  const reset = () => {
    measuredAtEstimate = new WeakSet();
  };

  return { measure, reset, shouldAdjustScrollPositionOnItemSizeChange };
};

type ViewportAnchor = {
  keys: ReadonlyArray<string>;
  first: number;
  rows: ReadonlyArray<VirtualItem>;
  offset: number;
};

const captureAnchor = (
  virtualizer: ScrollVirtualizer,
  keys: ReadonlyArray<string>
): ViewportAnchor | undefined => {
  const element = virtualizer.scrollElement;
  const offset = virtualizer.scrollOffset ?? 0;
  const height = virtualizer.scrollRect?.height ?? 0;
  if (element === null || element.scrollTop <= 1 || height <= 0) return;

  const first = virtualizer.getVirtualItemForOffset(offset);
  if (first === undefined || first.end <= offset) return;

  const rows = [];
  for (let index = first.index; index < keys.length; index += 1) {
    const row = virtualizer.measurementsCache[index];
    if (row === undefined || row.start >= offset + height) break;
    rows.push(row);
  }

  return { keys, first: first.index, rows, offset };
};

const resolveAnchor = (
  instance: ScrollVirtualizer,
  anchor: ViewportAnchor,
  movement: number
) => {
  const { count, getItemKey } = instance.options;
  const indexes = new Map(
    Array.from({ length: count }, (_, index) => [getItemKey(index), index])
  );
  for (const row of anchor.rows) {
    const index = indexes.get(row.key);
    if (index !== undefined)
      return { index, viewportOffset: row.start - anchor.offset - movement };
  }

  for (let index = anchor.first - 1; index >= 0; index -= 1) {
    const key = anchor.keys[index];
    const next = key === undefined ? undefined : indexes.get(key);
    if (next !== undefined) return { index: next, viewportOffset: 0 };
  }
};

const isIOS = (): boolean => {
  const { userAgent, platform, maxTouchPoints } = navigator;
  return (
    /iP(hone|od|ad)/.test(userAgent) ||
    (platform === 'MacIntel' && maxTouchPoints > 0)
  );
};

type ScrollRequest = { index: number } | { anchor: ViewportAnchor };

class ViewportScroll {
  private pending: ScrollRequest | undefined;
  private scheduled = false;
  private smooth = false;
  private deferred = false;

  constructor(private readonly virtualizer: ScrollVirtualizer) {}

  capture(keys: ReadonlyArray<string>): void {
    if (this.pending !== undefined) return;

    const anchor = captureAnchor(this.virtualizer, keys);
    if (anchor !== undefined) this.pending = { anchor };
  }

  select(index: number): void {
    this.pending = { index };
  }

  clear = (): void => {
    this.pending = undefined;
    this.deferred = false;
  };

  write: ScrollOptions['scrollToFn'] = (offset, options, instance) => {
    this.smooth = options.behavior === 'smooth';
    elementScroll(offset, options, instance);
  };

  onScrollEnd = (): void => {
    this.smooth = false;
    this.afterCommit();
  };

  afterCommit = (): void => {
    if (this.pending === undefined || this.scheduled) return;

    this.scheduled = true;
    // Solid commits the virtual spacer after the options effect publishes its size.
    queueMicrotask(this.apply);
  };

  private readonly apply = (): void => {
    this.scheduled = false;
    const request = this.pending;
    if (request === undefined) return;

    if ('index' in request) {
      this.clear();
      this.virtualizer.scrollToIndex(request.index, { align: 'auto' });
      return;
    }

    if (this.smooth || (isIOS() && this.virtualizer.isScrolling)) {
      this.deferred = true;
      return;
    }

    const movement = this.deferred
      ? (this.virtualizer.scrollOffset ?? 0) - request.anchor.offset
      : 0;
    this.clear();
    this.restore(request.anchor, movement);
  };

  private restore(anchor: ViewportAnchor, movement: number): void {
    const instance = this.virtualizer;
    const target = resolveAnchor(instance, anchor, movement);
    // Refresh positions before reading the target, which may be offscreen.
    instance.getTotalSize();
    const row =
      target === undefined
        ? undefined
        : instance.measurementsCache[target.index];
    const offset =
      row !== undefined && target !== undefined
        ? row.start - target.viewportOffset
        : 0;
    if (offset !== instance.scrollOffset)
      instance.scrollToOffset(offset, { behavior: 'instant' });
  }
}

const sameKeys = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>
): boolean =>
  a.length === b.length && a.every((key, index) => key === b[index]);

class ListVirtualizer {
  private keys: ReadonlyArray<string> = [];
  private estimate: ListOptions['estimate'];
  private element: HTMLDivElement | null = null;
  private readonly estimateSize = (index: number): number => {
    if (typeof this.estimate === 'number') return this.estimate;

    const key = this.keys[index];
    return key === undefined
      ? DEFAULT_ESTIMATE_SIZE
      : (this.estimate?.(key) ?? DEFAULT_ESTIMATE_SIZE);
  };

  private readonly options = makeOptions(
    () => this.element,
    this.estimateSize,
    (instance, offset) => this.sync(instance, offset),
    () => this.scroll.onScrollEnd(),
    (offset, options, instance) => this.scroll.write(offset, options, instance)
  );
  readonly virtualizer = new Virtualizer(this.options);
  readonly scroll = new ViewportScroll(this.virtualizer);
  private readonly measurements = trackRowMeasurements(this.estimateSize);

  constructor(private readonly sync: SyncViewport) {
    this.virtualizer.shouldAdjustScrollPositionOnItemSizeChange =
      this.measurements.shouldAdjustScrollPositionOnItemSizeChange;
  }

  configure = (state: ListOptions, selection: number | undefined): void => {
    const keysChanged = !sameKeys(this.keys, state.keys);
    if (selection !== undefined) this.scroll.select(selection);
    else if (keysChanged) this.scroll.capture(this.keys);

    const estimateChanged = this.estimate !== state.estimate;
    this.updateOptions(state, keysChanged || estimateChanged);
    if (estimateChanged && typeof state.estimate !== 'function') {
      this.measurements.reset();
      this.virtualizer.measure();
    }

    this.virtualizer._willUpdate();
    this.sync(this.virtualizer);
    this.scroll.afterCommit();
  };

  private updateOptions(state: ListOptions, rebuildPositions: boolean): void {
    this.keys = state.keys;
    this.estimate = state.estimate;
    this.element = state.element;
    this.virtualizer.setOptions({
      ...this.options,
      count: this.keys.length,
      // Invalidate positions while preserving measured sizes by key.
      getItemKey: rebuildPositions
        ? (index) => state.keys[index] ?? index
        : this.virtualizer.options.getItemKey,
      overscan: state.overscan ?? DEFAULT_OVERSCAN,
      measureElement: this.measurements.measure,
    });
  }
}

export const useVirtualList = (sync: SyncViewport) => {
  const [element, setElement] = createSignal<HTMLDivElement | null>(null, {
    name: 'virtualListElement',
  });
  const { virtualizer, configure, scroll } = new ListVirtualizer(sync);
  onSettled(() => virtualizer._didMount());
  onCleanup(scroll.clear);
  return { virtualizer, element, setElement, configure };
};
