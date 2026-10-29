import { A } from '@solidjs/router';
import { Show } from 'solid-js';
import type { ReadingLink } from '../../lib/links';
import { Button } from '../atoms/button';
import {
  EntryMeta,
  EntryReadToggle,
  EntrySurface,
  EntryTitle,
} from './list-entry';

type ReadingItemProps = {
  readonly item: ReadingLink;
  readonly pending: boolean;
  readonly onToggle: (item: ReadingLink) => void;
  readonly onDelete: (item: ReadingLink) => void;
  readonly onSelect?: ((item: ReadingLink) => void) | undefined;
  readonly selectedKey?: string | undefined;
};

const hostOf = (url: string): string => new URL(url).hostname;

const ReadingItemActions = (props: ReadingItemProps) => (
  <div class="relative z-1 flex gap-5">
    <A href={`/read/link/${props.item.key}`} class="hover:underline">
      站内阅读
    </A>
    <Button
      type="button"
      class="hover:text-base-content underline-offset-4 hover:underline"
      disabled={props.pending}
      onClick={() => props.onToggle(props.item)}
    >
      {props.item.read ? '恢复未读' : '标记已读'}
    </Button>
    <Button
      type="button"
      class="hover:text-base-content underline-offset-4 hover:underline"
      disabled={props.pending}
      onClick={() => props.onDelete(props.item)}
    >
      删除
    </Button>
  </div>
);

const StandaloneTitle = (props: { item: ReadingLink }) => (
  <EntryTitle href={props.item.url} target="_blank" rel="noopener noreferrer">
    {props.item.title}
    <span class="sr-only">（在新标签页打开）</span>
  </EntryTitle>
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
    <EntryTitle
      href={`/read/link/${props.item.key}`}
      current={selected()}
      onClick={handleSelect}
    >
      {props.item.title}
    </EntryTitle>
  );
};

export const ReadingItem = (props: ReadingItemProps) => {
  const integrated = () => props.onSelect !== undefined;
  const selected = () =>
    props.selectedKey !== undefined && props.item.key === props.selectedKey;

  return (
    <EntrySurface
      component="div"
      read={props.item.read}
      selected={integrated() && selected()}
    >
      <Show when={integrated()}>
        <EntryMeta
          source={hostOf(props.item.url)}
          time={props.item.createdAt}
        />
      </Show>
      <Show when={integrated()}>
        <EntryReadToggle
          label={props.item.title}
          read={props.item.read}
          pending={props.pending}
          onToggle={() => props.onToggle(props.item)}
        />
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
        <EntryMeta
          source={hostOf(props.item.url)}
          time={props.item.createdAt}
        />
        <Show when={!integrated()}>
          <ReadingItemActions
            item={props.item}
            pending={props.pending}
            onToggle={props.onToggle}
            onDelete={props.onDelete}
          />
        </Show>
      </div>
    </EntrySurface>
  );
};
