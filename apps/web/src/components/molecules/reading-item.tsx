import { A } from '@solidjs/router';
import { Show } from 'solid-js';
import type { ReadingLink } from '../../lib/links';
import { EntryTime } from './list-toolbar';

type ReadingItemProps = {
  readonly item: ReadingLink;
  readonly pending: boolean;
  readonly onToggle: (item: ReadingLink) => void;
  readonly onDelete: (item: ReadingLink) => void;
  readonly onSelect?: ((item: ReadingLink) => void) | undefined;
  readonly selectedKey?: string | undefined;
};

const hostOf = (url: string): string => new URL(url).hostname;

const ReadingItemMeta = (props: { item: ReadingLink }) => (
  <span class="entry-source">
    <span>{hostOf(props.item.url)}</span>
    <EntryTime value={props.item.createdAt} />
  </span>
);

const ReadingItemActions = (props: ReadingItemProps) => (
  <div class="flex gap-5">
    <A href={`/read/link/${props.item.key}`} class="hover:underline">
      站内阅读
    </A>
    <button
      type="button"
      class="hover:text-base-content underline-offset-4 hover:underline"
      disabled={props.pending}
      onClick={() => props.onToggle(props.item)}
    >
      {props.item.read ? '恢复未读' : '标记已读'}
    </button>
    <button
      type="button"
      class="hover:text-base-content underline-offset-4 hover:underline"
      disabled={props.pending}
      onClick={() => props.onDelete(props.item)}
    >
      删除
    </button>
  </div>
);

const StandaloneTitle = (props: { item: ReadingLink }) => (
  <a
    class="entry-title block text-lg font-medium leading-relaxed break-words hover:underline underline-offset-4"
    href={props.item.url}
    target="_blank"
    rel="noopener noreferrer"
  >
    {props.item.title}
    <span class="sr-only">（在新标签页打开）</span>
  </a>
);

const SelectableTitle = (props: ReadingItemProps) => {
  const selected = () =>
    props.selectedKey !== undefined && props.item.key === props.selectedKey;
  const handleSelect = (event: MouseEvent) => {
    const onSelect = props.onSelect;
    if (!onSelect) {
      return;
    }
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onSelect(props.item);
  };

  return (
    <a
      class="entry-title block text-base font-medium leading-relaxed break-words hover:underline underline-offset-4"
      href={`/read/link/${props.item.key}`}
      aria-current={selected() || undefined}
      onClick={handleSelect}
    >
      {props.item.title}
    </a>
  );
};

export const ReadingItem = (props: ReadingItemProps) => {
  const integrated = () => props.onSelect !== undefined;
  const selected = () =>
    props.selectedKey !== undefined && props.item.key === props.selectedKey;

  return (
    <li
      class="reading-entry"
      classList={{
        'entry-selected': integrated() && selected(),
        'entry-unread': !props.item.read,
      }}
    >
      <Show when={integrated()}>
        <ReadingItemMeta item={props.item} />
      </Show>
      <Show
        when={integrated()}
        fallback={<StandaloneTitle item={props.item} />}
      >
        <SelectableTitle
          item={props.item}
          pending={props.pending}
          onToggle={props.onToggle}
          onDelete={props.onDelete}
          onSelect={props.onSelect}
          selectedKey={props.selectedKey}
        />
      </Show>
      <div
        class="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-base-content/55"
        hidden={integrated()}
      >
        <ReadingItemMeta item={props.item} />
        <Show when={!integrated()}>
          <ReadingItemActions
            item={props.item}
            pending={props.pending}
            onToggle={props.onToggle}
            onDelete={props.onDelete}
          />
        </Show>
      </div>
    </li>
  );
};
