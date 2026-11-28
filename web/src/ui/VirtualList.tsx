import type { JSX } from '@solidjs/web';
import type { VirtualItem } from '@tanstack/virtual-core';
import { createEffect, createSignal, For, Show, untrack } from 'solid-js';
import type { ScrollVirtualizer } from './virtual-list-core';
import { useVirtualList } from './virtual-list-core';

export interface VirtualListProps {
  /** Stable row keys in list order; each key's row is rendered once and kept while it stays visible. */
  keys: ReadonlyArray<string>;
  /** Estimated row height in pixels before real measurement, optionally by key. */
  estimateSize?: number | ((key: string) => number);
  /** Extra rows rendered above and below the viewport. */
  overscan?: number;
  /** Reports the inclusive rendered and visible index ranges. An empty render has end < start. */
  onRangeChange?: (
    rendered: { start: number; end: number },
    visible: { first: number; last: number } | null
  ) => void;
  renderItem: (key: string) => JSX.Element;
  header?: JSX.Element;
  footer?: JSX.Element;
  /** Extra classes for the scroll container. */
  class?: string;
  /** Row index to scroll into view when `activeKey` changes or becomes available. */
  activeIndex?: number;
  /** Identifier for the active row so changes to the list do not re-scroll to the same item. */
  activeKey?: string | null;
}

const isVisible = (el: HTMLElement): boolean => {
  for (
    let current: HTMLElement | null = el;
    current !== null;
    current = current.parentElement
  ) {
    if (window.getComputedStyle(current).display === 'none') return false;
  }

  return true;
};

type RangeChange = NonNullable<VirtualListProps['onRangeChange']>;
type ListRange = {
  rendered: Parameters<RangeChange>[0];
  visible: Parameters<RangeChange>[1];
};

const rangeOf = (
  instance: ScrollVirtualizer,
  rows: ReadonlyArray<VirtualItem>,
  offset: number
): ListRange => {
  const height = instance.scrollRect?.height ?? 0;
  const el = instance.scrollElement;
  if (el === null || height <= 0 || !isVisible(el)) {
    return { rendered: { start: 0, end: -1 }, visible: null };
  }

  const rendered = {
    start: rows[0]?.index ?? 0,
    end: rows.at(-1)?.index ?? -1,
  };
  return { rendered, visible: intersectingRows(rows, offset, height) };
};

const intersectingRows = (
  rows: ReadonlyArray<VirtualItem>,
  offset: number,
  height: number
): ListRange['visible'] => {
  let first: number | undefined;
  let last: number | undefined;
  for (const row of rows) {
    if (row.end <= offset || row.start >= offset + height) continue;

    first ??= row.index;
    last = row.index;
  }

  return first === undefined || last === undefined ? null : { first, last };
};

const sameRange = (a: ListRange | undefined, b: ListRange): boolean =>
  a?.rendered.start === b.rendered.start &&
  a.rendered.end === b.rendered.end &&
  a.visible?.first === b.visible?.first &&
  a.visible?.last === b.visible?.last;

const useMeasurements = (props: VirtualListProps) => {
  const [rows, setRows] = createSignal<Array<VirtualItem>>([]);
  const [totalSize, setTotalSize] = createSignal(0);
  const [range, setRange] = createSignal<ListRange | undefined>(undefined);
  const sync = (
    instance: ScrollVirtualizer,
    offset = instance.scrollOffset ?? 0
  ): void => {
    const items = instance.getVirtualItems();
    setRows(items);
    setTotalSize(instance.getTotalSize());
    const next = rangeOf(instance, items, offset);
    setRange((previous) => (sameRange(previous, next) ? previous : next));
  };

  createEffect(
    () => ({ current: range(), report: props.onRangeChange }),
    ({ current, report }) => {
      if (current !== undefined && report !== undefined) {
        report(current.rendered, current.visible);
      }
    }
  );
  return { sync, rows, totalSize };
};

interface RowsProps {
  virtualizer: ScrollVirtualizer;
  rows: Array<VirtualItem>;
  totalSize: number;
  count: number;
  render: (key: string) => JSX.Element;
}

/** Positioned window of virtual rows; only these nodes exist in the DOM. */
const VirtualRows = (props: RowsProps): JSX.Element => (
  <div class="relative w-full" style={{ height: `${props.totalSize}px` }}>
    <For each={props.rows} keyed={(item) => item.key}>
      {(item) => (
        // Virtual rows trail `keys` by one update; a row past the end of a shrunk list renders nothing.
        <Show when={item().index < props.count}>
          <div
            data-index={item().index}
            ref={(el) => {
              // Attributes are applied after `ref` runs; measure once the
              // `data-index` attribute has been written.
              queueMicrotask(() => props.virtualizer.measureElement(el));
            }}
            class="absolute inset-x-0 top-0"
            style={{ transform: `translateY(${item().start}px)` }}
          >
            {untrack(() => props.render(String(item().key)))}
          </div>
        </Show>
      )}
    </For>
  </div>
);

class ActiveScrollTracker {
  private key: string | null | undefined;
  private index: number | undefined;

  getTarget(
    key: VirtualListProps['activeKey'],
    index: VirtualListProps['activeIndex'],
    length: number
  ): number | undefined {
    const valid = index !== undefined && index >= 0 && index < length;
    if (key !== undefined) {
      if (this.key === key) return;

      this.key = valid ? key : null;
      return valid ? index : undefined;
    }

    if (this.index === index) return;

    this.index = valid ? index : undefined;
    return this.index;
  }
}

const configureVirtualizer = (
  props: VirtualListProps,
  list: ReturnType<typeof useVirtualList>
): void => {
  const tracker = new ActiveScrollTracker();
  createEffect(
    () => ({
      keys: [...props.keys],
      estimate: props.estimateSize,
      overscan: props.overscan,
      activeKey: props.activeKey,
      activeIndex: props.activeIndex,
      element: list.element(),
    }),
    ({ activeKey, activeIndex, ...options }) => {
      if (options.element === null) return;

      const target = tracker.getTarget(
        activeKey,
        activeIndex,
        options.keys.length
      );
      list.configure({ ...options, element: options.element }, target);
    }
  );
};

export function VirtualList(props: VirtualListProps): JSX.Element {
  const { sync, rows, totalSize } = useMeasurements(props);
  const list = useVirtualList(sync);
  configureVirtualizer(props, list);

  return (
    <div
      ref={list.setElement}
      class={[
        'h-full overflow-y-auto overscroll-contain [overflow-anchor:none]',
        props.class,
      ]}
    >
      <Show when={props.header}>{props.header}</Show>
      <VirtualRows
        virtualizer={list.virtualizer}
        rows={rows()}
        totalSize={totalSize()}
        count={props.keys.length}
        render={props.renderItem}
      />
      <Show when={props.footer}>{props.footer}</Show>
    </div>
  );
}
