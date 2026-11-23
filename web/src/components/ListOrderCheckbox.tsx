import type { JSX } from '@solidjs/web';
import type { Feed } from '../api';
import { t } from '../i18n';
import {
  aggregateOrder,
  changeFeedOrder,
  toggleAggregateOrder,
} from '../state';
import { MenuCheckbox } from '../ui';

/**
 * `FD-PREF-1`: `从旧到新` toggle. A feed row/list stores its own order; every other list shares one
 * locally persisted order.
 */
export function ListOrderCheckbox(props: { feed: Feed | null }): JSX.Element {
  const oldest = (): boolean =>
    props.feed ? props.feed.order === 'oldest' : aggregateOrder() === 'oldest';
  const toggle = (): void => {
    const feed = props.feed;
    if (feed) {
      void changeFeedOrder(feed, feed.order === 'oldest' ? 'newest' : 'oldest');
      return;
    }

    void toggleAggregateOrder();
  };

  return (
    <MenuCheckbox icon="sort" checked={oldest()} onSelect={toggle}>
      {String(t('feeds.oldestFirst'))}
    </MenuCheckbox>
  );
}
