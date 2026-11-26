import type { JSX } from '@solidjs/web';
import type { VirtualItem } from '@tanstack/virtual-core';
import { createEffect, For, Show, untrack } from 'solid-js';
import type { ScrollVirtualizer } from './virtual-list-core';
import { useVirtualList } from './virtual-list-core';

export interface VirtualListProps {
  /** Stable row keys in list order; each key's row is rendered once and kept while it stays visible. */
  keys: ReadonlyArray<string>;
  /** Estimated row height in pixels before real measurement. */
  estimateSize?: number;
  /** Extra rows rendered above and below the viewport. */
  overscan?: number;
  /** Called when the scroll position is near the end, or content fits the viewport. */
  onEndReached?: () => void;
  /** Distance from the bottom (px) that triggers `onEndReached`. */
  endReachedThreshold?: number;
  renderItem: (key: string) => JSX.Element;
  header?: JSX.Element;
  footer?: JSX.Element;
  /** Extra classes for the scroll container. */
  class?: string;
  /** Row index to scroll into view when `activeKey` changes or becomes available. */
  activeIndex?: number;
  /** Identifier for the active row so appending rows does not re-scroll to the same item. */
  activeKey?: string | null;
}

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

  shouldScroll(
    key: string | null | undefined,
    index: number | undefined,
    length: number
  ): index is number {
    if (key !== undefined) {
      if (this.key === key) return false;
      this.key = null;
    }
    if (index === undefined || index < 0 || index >= length) {
      if (key === undefined) this.index = undefined;
      return false;
    }
    if (key !== undefined) {
      this.key = key;
      return true;
    }
    if (this.index === index) return false;
    this.index = index;
    return true;
  }
}

export function VirtualList(props: VirtualListProps): JSX.Element {
  const list = useVirtualList(props);
  const tracker = new ActiveScrollTracker();

  createEffect(
    () => ({
      key: props.activeKey,
      index: props.activeIndex,
      length: props.keys.length,
    }),
    ({ key, index, length }) => {
      if (tracker.shouldScroll(key, index, length)) {
        list.virtualizer.scrollToIndex(index, { align: 'auto' });
      }
    }
  );

  return (
    <div
      ref={list.setScrollElement}
      class={['h-full overflow-y-auto overscroll-contain', props.class]}
      onScroll={list.onScroll}
    >
      <Show when={props.header}>{props.header}</Show>
      <VirtualRows
        virtualizer={list.virtualizer}
        rows={list.rows()}
        totalSize={list.totalSize()}
        count={props.keys.length}
        render={props.renderItem}
      />
      <Show when={props.footer}>{props.footer}</Show>
    </div>
  );
}
