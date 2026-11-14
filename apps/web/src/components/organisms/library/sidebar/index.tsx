import type { Counts, Feed, Folder, Scope } from '../../../../api/library';
import { ReaderIcon } from '../../../atoms/reader-icon';
import { type ScopeMenu, ScopeRow } from '../../../molecules/scope-row';
import { LibraryAccountMenu } from '../account-menu';
import { LibrarySidebarFeeds } from './feeds';

type LibrarySidebarProps = {
  readonly scope: Scope;
  readonly counts: Counts;
  readonly feeds: ReadonlyArray<Feed>;
  readonly folders: ReadonlyArray<Folder>;
  readonly pending: ReadonlySet<string>;
  readonly unreadOnly: boolean;
  readonly onFilterScope: (scope: Scope, checked: boolean) => void;
  readonly onMarkScope: (scope: Scope) => void;
  readonly onUnsubscribe: (feed: Feed) => void;
  readonly onMoveFeed: (feed: Feed) => void;
  readonly onCreateFolder: () => void;
  readonly onRenameFolder: (folder: Folder) => void;
  readonly onRemoveFolder: (folder: Folder) => void;
  readonly onPickScope: (scope: Scope) => void;
  readonly onAdd: (mode: 'article' | 'feed') => void;
};

const laterMenu = (props: LibrarySidebarProps): ScopeMenu => ({
  label: '「稍后阅读」操作',
  triggerLabel: '「稍后阅读」菜单',
  unreadOnly: props.unreadOnly,
  busy: props.pending.size > 0,
  onFilter: (checked) => props.onFilterScope({ kind: 'later' }, checked),
  onMarkAll: () => props.onMarkScope({ kind: 'later' }),
  createArticle: {
    label: '新增文章链接',
    icon: 'plus',
    onSelect: () => props.onAdd('article'),
  },
});

const allMenu = (props: LibrarySidebarProps): ScopeMenu => ({
  label: '「全部订阅」操作',
  triggerLabel: '「全部订阅」菜单',
  unreadOnly: props.unreadOnly,
  busy: props.pending.size > 0,
  onFilter: (checked) => props.onFilterScope({ kind: 'feeds' }, checked),
  onMarkAll: () => props.onMarkScope({ kind: 'feeds' }),
});

const PrimaryScopes = (props: LibrarySidebarProps) => (
  <ul aria-label="阅读来源" class="flex shrink-0 flex-col gap-1">
    <li>
      <ScopeRow
        icon="bookmark"
        label="稍后阅读"
        count={props.counts.later}
        active={props.scope.kind === 'later'}
        menu={laterMenu(props)}
        onPick={() => props.onPickScope({ kind: 'later' })}
      />
    </li>
    <li>
      <ScopeRow
        icon="all"
        label="全部订阅"
        count={props.counts.feedsTotal}
        active={
          props.scope.kind === 'feeds' && props.scope.feedId === undefined
        }
        menu={allMenu(props)}
        onPick={() => props.onPickScope({ kind: 'feeds' })}
      />
    </li>
  </ul>
);

export const LibrarySidebar = (props: LibrarySidebarProps) => (
  <nav
    aria-label="阅读导航"
    class="flex h-full min-h-0 min-w-0 flex-col gap-1 overflow-hidden px-3 pb-3"
  >
    <header class="mb-2 flex h-13 shrink-0 items-center justify-between gap-2 px-2">
      <h1 class="flex items-center gap-2.5 text-xl font-semibold tracking-[0.08em]">
        <ReaderIcon name="feed" class="size-6 text-brand" />
        留白
      </h1>
      <LibraryAccountMenu />
    </header>
    <PrimaryScopes {...props} />
    <LibrarySidebarFeeds
      folders={props.folders}
      feeds={props.feeds}
      counts={props.counts}
      scope={props.scope}
      pending={props.pending}
      unreadOnly={props.unreadOnly}
      onFilterScope={props.onFilterScope}
      onMarkScope={props.onMarkScope}
      onUnsubscribe={props.onUnsubscribe}
      onMoveFeed={props.onMoveFeed}
      onRenameFolder={props.onRenameFolder}
      onRemoveFolder={props.onRemoveFolder}
      onPickScope={props.onPickScope}
      onAdd={props.onAdd}
      onCreateFolder={props.onCreateFolder}
    />
  </nav>
);
