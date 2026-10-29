import { type JSX, Show } from 'solid-js';
import type { InfiniteState } from '../../lib/infinite';
import { ErrorToast, useErrorToast } from './error-toast';
import { VirtualScroller } from './virtual-scroller';

type InfiniteEntriesProps<T> = {
  readonly items: readonly T[];
  readonly state: InfiniteState<T>;
  readonly active?: boolean | undefined;
  readonly getKey: (item: T) => string;
  readonly estimateSize: number;
  readonly emptyTitle: string;
  readonly emptyHint: string;
  readonly onLoadMore: () => void;
  readonly onRetry: () => void;
  readonly children: (item: T) => JSX.Element;
};

const InfiniteEmpty = (props: {
  readonly title: string;
  readonly hint: string;
}) => (
  <div class="grid min-h-0 flex-1 place-items-center px-6 py-16 text-center">
    <div>
      <p class="text-lg">{props.title}</p>
      <p class="mt-3 text-sm text-base-content/50">{props.hint}</p>
    </div>
  </div>
);

export const InfiniteEntries = <T,>(props: InfiniteEntriesProps<T>) => {
  const toast = useErrorToast(
    () => props.state.error,
    () => props.active ?? true
  );
  const loadMore = () => {
    if (!(props.active ?? true) || !props.state.initialized) return;

    props.onLoadMore();
  };
  const loadedEmpty = () =>
    props.state.initialized && !props.state.hasMore && props.items.length === 0;

  return (
    <>
      <Show
        when={!loadedEmpty()}
        fallback={
          <InfiniteEmpty title={props.emptyTitle} hint={props.emptyHint} />
        }
      >
        <VirtualScroller
          items={props.items}
          revision={props.state.items.length}
          getKey={props.getKey}
          estimateSize={props.estimateSize}
          onEndReached={loadMore}
        >
          {props.children}
        </VirtualScroller>
      </Show>
      <Show when={toast.message()}>
        {(message) => (
          <ErrorToast
            message={message()}
            onRetry={props.onRetry}
            onDismiss={toast.dismiss}
          />
        )}
      </Show>
    </>
  );
};
