import { For, Show } from 'solid-js';
import { folders, openMoveFeed } from '../folder';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { MenuCheckbox } from '../ui/menu-checkbox';
import { MenuRadio } from '../ui/menu-radio';
import type { Feed, FeedReaderMode } from './list';
import { chooseFeedOrder, chooseFeedReaderMode } from './preference';
import { confirmUnsubscribe } from './unsubscribe';

const destructiveClass = 'mt-2 border-t border-base-300 pt-2';

const groupClass = 'mt-2 border-t border-base-300 pt-2';

/** The reader-mode items in their menu order (feeds.md Messages). */
const readerModes: ReadonlyArray<{
  readonly mode: FeedReaderMode;
  readonly label: string;
}> = [
  { mode: 'default', label: '默认显示：原文内容' },
  { mode: 'extracted', label: '默认显示：提取正文' },
  { mode: 'embedded', label: '默认显示：嵌入式网页' },
];

/** The feed's preferences (FD-PREF): its list order and its reader mode. */
const PreferenceItems = (props: {
  readonly feed: Feed;
  readonly close: () => void;
}) => (
  <>
    <li class={groupClass}>
      <MenuCheckbox
        label="从旧到新"
        checked={props.feed.order === 'oldest'}
        onChange={(oldest) => {
          props.close();
          void chooseFeedOrder(props.feed.id, oldest ? 'oldest' : 'newest');
        }}
      />
    </li>
    <For each={readerModes}>
      {(item) => (
        <li>
          <MenuRadio
            name={`reader-mode-${props.feed.id}`}
            label={item.label}
            checked={props.feed.readerMode === item.mode}
            onSelect={() => {
              props.close();
              void chooseFeedReaderMode(props.feed.id, item.mode);
            }}
          />
        </li>
      )}
    </For>
  </>
);

/**
 * A feed scope's extra menu items, after `全部标记为已读` (feeds.md Interface):
 * the feed's preferences, `移动到目录` only when a folder exists, then
 * `删除 RSS 源`.
 */
export const FeedMenuItems = (props: {
  readonly feed: Feed;
  readonly close: () => void;
}) => (
  <>
    <PreferenceItems feed={props.feed} close={props.close} />
    <Show when={folders().length > 0}>
      <li class={groupClass}>
        <Button
          onClick={() => {
            props.close();
            openMoveFeed(props.feed);
          }}
        >
          <Icon name="folder" />
          移动到目录
        </Button>
      </li>
    </Show>
    <li class={destructiveClass}>
      <Button
        class="text-error"
        onClick={() => {
          props.close();
          confirmUnsubscribe(props.feed);
        }}
      >
        <Icon name="delete" />
        删除 RSS 源
      </Button>
    </li>
  </>
);
