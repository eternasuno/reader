import type { JSX } from '@solidjs/web';
import type { Feed } from '../api';
import { t } from '../i18n';
import { changeFeedOrder } from '../state';
import { MenuCheckbox } from '../ui';

/** `FD-PREF-1`: stores the list order for a single feed. */
export function ListOrderCheckbox(props: { feed: Feed }): JSX.Element {
  const oldest = (): boolean => props.feed.order === 'oldest';
  const toggle = (): void => {
    void changeFeedOrder(props.feed, oldest() ? 'newest' : 'oldest');
  };

  return (
    <MenuCheckbox icon="sort" checked={oldest()} onSelect={toggle}>
      {t('feeds.oldestFirst')}
    </MenuCheckbox>
  );
}
