import type { JSX } from '@solidjs/web';
import type { Feed } from '../api';
import { t } from '../i18n';
import { Icon, Menu, MenuItem } from '../ui';
import { retryRefresh } from './feedFailure';

/** `FD-SCHED-3`: warning menu exposing the stored refresh error, retry, and unsubscribe. */
export function FeedFailureMenu(props: {
  feed: Feed;
  onDelete: (feed: Feed) => void;
}): JSX.Element {
  return (
    <Menu
      label={t('feeds.retryRefresh')}
      triggerClass="btn-xs btn-square pointer-coarse:size-9"
      trigger={
        <span
          class="inline-flex items-center justify-center"
          title={props.feed.lastError}
        >
          <Icon name="warning" size={14} class="text-warning" />
        </span>
      }
    >
      <div
        role="presentation"
        class="max-w-56 px-3 py-1.5 text-xs break-words text-base-content/70"
      >
        {props.feed.lastError}
      </div>
      <MenuItem icon="refresh" onSelect={() => void retryRefresh(props.feed)}>
        {t('feeds.retryRefresh')}
      </MenuItem>
      <MenuItem danger icon="trash" onSelect={() => props.onDelete(props.feed)}>
        {t('feeds.deleteFeedMenu')}
      </MenuItem>
    </Menu>
  );
}
