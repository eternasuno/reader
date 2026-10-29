import type { InfiniteState } from '../../lib/infinite';
import type { ReadingLink } from '../../lib/links';
import { InfiniteEntries } from '../molecules/infinite-entries';
import { ReadingItem } from '../molecules/reading-item';

type ReadingEntriesProps = {
  readonly onlyUnread: boolean;
  readonly active?: boolean | undefined;
  readonly items: readonly ReadingLink[] | undefined;
  readonly state: InfiniteState<ReadingLink>;
  readonly pending: boolean;
  readonly onToggle: (item: ReadingLink) => void;
  readonly onDelete: (item: ReadingLink) => void;
  readonly onLoadMore: () => void;
  readonly onRetry: () => void;
  readonly onSelect?: ((item: ReadingLink) => void) | undefined;
  readonly selectedKey?: string | undefined;
};

const emptyHint = (onlyUnread: boolean): string =>
  onlyUnread ? '读完后，手动标记一下。' : '添加一个链接，留给下次阅读。';

const emptyTitle = (onlyUnread: boolean): string =>
  onlyUnread ? '没有未读文章' : '清单很轻，刚刚好。';

export const ReadingEntries = (props: ReadingEntriesProps) => (
  <InfiniteEntries
    items={props.items ?? []}
    state={props.state}
    active={props.active ?? true}
    getKey={(item) => item.key}
    estimateSize={108}
    emptyTitle={emptyTitle(props.onlyUnread)}
    emptyHint={emptyHint(props.onlyUnread)}
    onLoadMore={props.onLoadMore}
    onRetry={props.onRetry}
  >
    {(item) => (
      <ReadingItem
        item={item}
        pending={props.pending}
        onToggle={props.onToggle}
        onDelete={props.onDelete}
        onSelect={props.onSelect}
        selectedKey={props.selectedKey}
      />
    )}
  </InfiniteEntries>
);
