import { Show } from 'solid-js';
import { folders, openMoveFeed } from '../folder';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import type { Feed } from './list';
import { confirmUnsubscribe } from './unsubscribe';

const destructiveClass = 'mt-2 border-t border-base-300 pt-2';

/**
 * A feed scope's extra menu items, after `全部标记为已读` (feeds.md Interface):
 * `移动到目录` only when a folder exists, then `删除 RSS 源`.
 */
export const FeedMenuItems = (props: {
  readonly feed: Feed;
  readonly close: () => void;
}) => (
  <>
    <Show when={folders().length > 0}>
      <li>
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
