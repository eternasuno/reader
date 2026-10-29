import { createVirtualizer } from '@tanstack/solid-virtual';
import {
  createEffect,
  Index,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

type VirtualScrollerProps<T> = {
  readonly items: readonly T[];
  readonly revision: number;
  readonly getKey: (item: T) => string;
  readonly estimateSize: number;
  readonly onEndReached: () => void;
  readonly children: (item: T) => JSX.Element;
};

const endThreshold = 600;

const nearEnd = (element: HTMLDivElement): boolean =>
  element.scrollHeight - element.scrollTop - element.clientHeight <
  endThreshold;

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

export const VirtualScroller = <T,>(props: VirtualScrollerProps<T>) => {
  let scrollRef: HTMLDivElement | undefined;
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return props.items.length;
    },
    getScrollElement: () => scrollRef ?? null,
    estimateSize: () => props.estimateSize,
    getItemKey: (index) => {
      const item = props.items[index];

      return item ? props.getKey(item) : index;
    },
    overscan: 4,
  });
  const layoutRevision = () =>
    `${props.items.length}:${props.revision}:${virtualizer.getTotalSize()}`;
  const handleScroll = useEndReached(
    () => scrollRef,
    layoutRevision,
    props.onEndReached
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
                  ref={(element) => virtualizer.measureElement(element)}
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
