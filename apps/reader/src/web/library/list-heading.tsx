import { Show } from 'solid-js';
import { FeedMenuItems, feedById } from '../feed';
import { LaterMenuItems } from '../saved-page';
import { Button, IconButton } from '../ui/button';
import { Icon } from '../ui/icon';
import { Menu } from '../ui/menu';
import { MenuCheckbox } from '../ui/menu-checkbox';
import { copy } from './messages';
import { markAllInScope, markLoadedRead } from './read';
import { currentScope, setUnreadFilter, unreadFilter } from './route';

export type ListHeadingProps = {
  readonly name: string;
  readonly count: number;
};

const currentFeed = () => {
  const scope = currentScope();

  return scope.kind === 'feed' ? feedById(scope.id) : undefined;
};

/** The list's overflow menu: the shared items, then the selected scope's (LIB-MENU-3). */
const ListMenu = () => (
  <Menu
    label={copy.listMenuLabel}
    trigger={(target) => (
      <IconButton label={copy.listMenuTrigger} popoverTarget={target}>
        <Icon name="more" />
      </IconButton>
    )}
  >
    {(close) => (
      <>
        <li>
          <MenuCheckbox
            label={copy.filterItem}
            checked={unreadFilter()}
            onChange={(on) => {
              close();
              setUnreadFilter(on);
            }}
          />
        </li>
        <li>
          <Button
            onClick={() => {
              close();
              void markAllInScope(currentScope());
            }}
          >
            <Icon name="checks" />
            {copy.markAllItem}
          </Button>
        </li>
        <Show when={currentScope().kind === 'later'}>
          <LaterMenuItems close={close} />
        </Show>
        <Show when={currentFeed()}>
          {(feed) => <FeedMenuItems feed={feed()} close={close} />}
        </Show>
      </>
    )}
  </Menu>
);

/**
 * The list pane's one compact heading row (library.md Interface): the scope's
 * name and unread count on the left, the mark-loaded action and the menu on the
 * right.
 */
export const ListHeading = (props: ListHeadingProps) => (
  <nav
    aria-label={`${props.name}${copy.listHeadingSuffix}`}
    class="flex min-h-13 shrink-0 items-center gap-2 border-b border-base-300 bg-base-100 px-4"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <h2 class="min-w-0 truncate text-sm font-semibold" tabindex="-1">
        {props.name}
      </h2>
      <span
        class="shrink-0 text-xs tabular-nums text-base-content/65"
        title={copy.headingCount(props.count)}
      >
        {props.count}
        <span class="sr-only"> 篇未读</span>
      </span>
    </div>
    <IconButton label={copy.markLoaded} onClick={() => void markLoadedRead()}>
      <Icon name="markAbove" />
    </IconButton>
    <ListMenu />
  </nav>
);
