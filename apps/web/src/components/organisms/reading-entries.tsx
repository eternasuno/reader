import { For, Show } from 'solid-js';
import type { ReadingLink } from '../../lib/links';
import { ReadingItem } from '../molecules/reading-item';

type ReadingEntriesProps = {
  readonly read: boolean;
  readonly items: readonly ReadingLink[] | undefined;
  readonly pending: boolean;
  readonly onToggle: (item: ReadingLink) => void;
  readonly onDelete: (item: ReadingLink) => void;
  readonly onSelect?: ((item: ReadingLink) => void) | undefined;
  readonly selectedKey?: string | undefined;
};

const emptyHint = (read: boolean): string =>
  read ? '读完后，手动标记一下。' : '添加一个链接，留给下次阅读。';

const emptyTitle = (read: boolean): string =>
  read ? '还没有已读文章' : '清单很轻，刚刚好。';

const ReadingEmpty = (props: { read: boolean }) => (
  <div class="py-20 text-center">
    <p class="text-lg">{emptyTitle(props.read)}</p>
    <p class="mt-3 text-sm text-base-content/50">{emptyHint(props.read)}</p>
  </div>
);

export const ReadingEntries = (props: ReadingEntriesProps) => (
  <Show
    when={props.items?.length}
    fallback={<ReadingEmpty read={props.read} />}
  >
    <ul class="reading-entries">
      <For each={props.items}>
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
      </For>
    </ul>
  </Show>
);
