import type { JSX } from '@solidjs/web';
import type { VirtualItem } from '@tanstack/virtual-core';
import { createEffect, For, Show } from 'solid-js';
import type { ScrollVirtualizer } from './virtual-list-core';
import { useVirtualList } from './virtual-list-core';

export interface VirtualListProps<T> {
  items: ReadonlyArray<T>;
  /** Estimated row height in pixels before real measurement. */
  estimateSize?: number;
  /** Extra rows rendered above and below the viewport. */
  overscan?: number;
  /** Called when the scroll position is near the end, or content fits the viewport. */
  onEndReached?: () => void;
  /** Distance from the bottom (px) that triggers `onEndReached`. */
  endReachedThreshold?: number;
  renderItem: (item: T, index: () => number) => JSX.Element;
  header?: JSX.Element;
  footer?: JSX.Element;
  /** Extra classes for the scroll container. */
  class?: string;
  /** Row index to scroll into view when changed. */
  activeIndex?: number;
}

interface RowsProps<T> {
  virtualizer: ScrollVirtualizer;
  rows: Array<VirtualItem>;
  totalSize: number;
  items: ReadonlyArray<T>;
  render: (item: T, index: () => number) => JSX.Element;
}

/** Positioned window of virtual rows; only these nodes exist in the DOM. */
const VirtualRows = <T,>(props: RowsProps<T>): JSX.Element => (
  <div class="relative w-full" style={{ height: `${props.totalSize}px` }}>
    <For each={props.rows} keyed={(item) => item.key}>
      {(item) => (
        // Virtual rows trail `items` by one update; a row past the end of a shrunk list renders nothing.
        <Show when={item().index < props.items.length}>
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
            {props.render(props.items[item().index] as T, () => item().index)}
          </div>
        </Show>
      )}
    </For>
  </div>
);

interface StaticRowsProps<T> {
  items: ReadonlyArray<T>;
  render: (item: T, index: () => number) => JSX.Element;
}

/** Fallback list used while the viewport has no measurable height. */
const StaticRows = <T,>(props: StaticRowsProps<T>): JSX.Element => (
  <For each={props.items}>
    {(item, index) => (
      <div data-index={index()}>{props.render(item, index)}</div>
    )}
  </For>
);

export function VirtualList<T>(props: VirtualListProps<T>): JSX.Element {
  const list = useVirtualList(props);

  createEffect(
    () => ({ index: props.activeIndex, fallback: list.fallbackVisible() }),
    ({ index, fallback }) => {
      if (index === undefined || index < 0 || index >= props.items.length) {
        return;
      }
      if (fallback) return;
      list.virtualizer.scrollToIndex(index, { align: 'auto' });
    }
  );

  return (
    <div
      ref={list.setScrollElement}
      class={['h-full overflow-y-auto overscroll-contain', props.class]}
      onScroll={list.onScroll}
    >
      <Show when={props.header}>{props.header}</Show>
      <Show
        when={list.fallbackVisible()}
        fallback={
          <VirtualRows
            virtualizer={list.virtualizer}
            rows={list.rows()}
            totalSize={list.totalSize()}
            items={props.items}
            render={props.renderItem}
          />
        }
      >
        <StaticRows items={props.items} render={props.renderItem} />
      </Show>
      <Show when={props.footer}>{props.footer}</Show>
    </div>
  );
}
