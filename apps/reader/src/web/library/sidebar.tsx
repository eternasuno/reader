import { allUnreadCount, FeedSection } from '../feed';
import { LaterMenuItems, savedPageUnreadCount } from '../saved-page';
import { Icon } from '../ui/icon';
import { AccountMenu } from './account-menu';
import { copy } from './messages';
import { ScopeRow } from './scope-row';

/**
 * The sidebar: the brand and the account menu, the reading sources, then the
 * `订阅源` section of feeds and folders (library.md Interface).
 */
export const LibrarySidebar = () => (
  <nav
    aria-label={copy.navLabel}
    class="flex h-full min-h-0 min-w-0 flex-col gap-1 overflow-hidden px-3 pb-3"
  >
    <header class="mb-2 flex h-13 shrink-0 items-center justify-between gap-2 px-2">
      <h1 class="flex items-center gap-2.5 text-xl font-semibold tracking-[0.08em]">
        <Icon name="feed" class="size-6 text-brand" />
        {copy.brand}
      </h1>
      <AccountMenu />
    </header>
    <ul aria-label={copy.sourcesLabel} class="flex shrink-0 flex-col gap-1">
      <li>
        <ScopeRow
          scope={{ kind: 'later' }}
          name={copy.laterName}
          count={savedPageUnreadCount()}
          icon="bookmark"
          children={(close) => <LaterMenuItems close={close} />}
        />
      </li>
      <li>
        <ScopeRow
          scope={{ kind: 'all' }}
          name={copy.allName}
          count={allUnreadCount()}
          icon="all"
        />
      </li>
    </ul>
    <FeedSection />
  </nav>
);
