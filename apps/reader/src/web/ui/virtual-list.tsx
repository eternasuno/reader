import { createVirtualizer } from '@tanstack/solid-virtual';
import {
  createEffect,
  Index,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

export type VirtualListProps<T> = {
  readonly items: ReadonlyArray<T>;
  /** The stable identity of a row, used as its virtualizer key. */
  readonly getKey: (item: T) => string;
  /** The height a row is assumed to have before it is measured. */
  readonly estimateSize: number;
  /** Called when the list is scrolled near its end, to load the next page. */
  readonly onEndReached?: (() => void) | undefined;
  readonly children: (item: T) => JSX.Element;
};

const endThreshold = 600;

const nearEnd = (element: HTMLDivElement): boolean =>
  element.scrollHeight - element.scrollTop - element.clientHeight <
  endThreshold;

/**
 * Keeps the "near the end" callback scheduled: it runs after a layout change and
 * on scroll, neither inside a reactive read nor on every scroll event.
 */
const useEndReached = (
  scrollElement: () => HTMLDivElement | undefined,
  layoutRevision: () => string,
  onEndReached: () => void
) => {
  let frame: number | undefined;
  const cancelCheck = () => {
    if (frame === undefined) return;

    cancelAnimationFrame(frame);
    frame = undefined;
  };
  const check = () => {
    const element = scrollElement();

    if (element && element.clientHeight > 0 && nearEnd(element)) onEndReached();
  };
  const scheduleCheck = () => {
    if (frame !== undefined) return;

    frame = requestAnimationFrame(() => {
      frame = undefined;
      check();
    });
  };

  createEffect(() => {
    layoutRevision();
    scheduleCheck();
  });
  onMount(() => {
    const element = scrollElement();

    if (!element) return;

    const observer = new ResizeObserver(scheduleCheck);

    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });
  onCleanup(cancelCheck);

  return check;
};

/**
 * The one virtualized list (ui.md): rows are measured after mount, the
 * virtualizer's resize tracking is kept, and only the visible rows plus a small
 * margin are rendered. `onEndReached` is how a paged list asks for its next page
 * (CM-PAGE-4).
 */
export const VirtualList = <T,>(props: VirtualListProps<T>) => {
  let scrollRef: HTMLDivElement | undefined;
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return props.items.length;
    },
    getScrollElement: () => scrollRef ?? null,
    estimateSize: () => props.estimateSize,
    getItemKey: (index) => {
      const item = props.items[index];

      return item === undefined ? index : props.getKey(item);
    },
    overscan: 4,
  });
  const layoutRevision = () =>
    `${props.items.length}:${virtualizer.getTotalSize()}`;
  const handleScroll = useEndReached(
    () => scrollRef,
    layoutRevision,
    () => props.onEndReached?.()
  );

  return (
    <div
      ref={(element) => {
        scrollRef = element;
      }}
      class="min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-width:thin]"
      onScroll={handleScroll}
    >
      <div
        class="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        <Index each={virtualizer.getVirtualItems()}>
          {(row) => (
            <Show when={props.items[row().index]} keyed>
              {(item) => (
                <div
                  data-index={row().index}
                  ref={(element) => {
                    onMount(() => virtualizer.measureElement(element));
                  }}
                  class="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${row().start}px)` }}
                >
                  {props.children(item)}
                </div>
              )}
            </Show>
          )}
        </Index>
      </div>
    </div>
  );
};
