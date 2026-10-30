import {
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from '@effect/atom-solid/Hooks';
import { Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { createEffect } from 'solid-js';
import { useMissingFeedGuard } from '../../pages/reader-navigation';
import { useWorkspaceData } from '../../pages/workspace-state';
import { NavButton } from '../atoms/nav-item';
import { ReaderIcon } from '../atoms/reader-icon';
import { FeedNavList } from '../molecules/feed-nav-list';
import { SourceNavRow } from '../molecules/source-nav';
import { WorkspaceAccountMenu } from './workspace-account-menu';
import {
  useFeedCommand,
  useSourceCommand,
  useUnreadRefresh,
} from './workspace-nav-commands';

type WorkspaceNavProps = {
  readonly scope: 'later' | 'rss';
  readonly feedKey: string;
  readonly feedRevision: number;
  readonly class?: string;
  readonly onPickLater: () => void;
  readonly onPickRss: () => void;
  readonly onManage: () => void;
  readonly onPickFeed: (key: string) => void;
  readonly onSettings: () => void;
};

const useWorkspaceAtoms = () => {
  const data = useWorkspaceData();

  return {
    data,
    feeds: useAtomValue(() => data.feeds.feeds),
    articles: useAtomValue(() => data.feeds.articles),
    mutation: useAtomValue(() => data.feeds.command),
    refreshFeeds: useAtomRefresh(() => data.feeds.feeds),
    runFeed: useAtomSet(() => data.feeds.command, { mode: 'promiseExit' }),
    unread: useAtomValue(() => data.reading.unread),
    refreshUnread: useAtomRefresh(() => data.reading.unread),
    linkArticles: useAtomValue(() => data.reading.state),
    readingMutation: useAtomValue(() => data.reading.command),
    runLink: useAtomSet(() => data.reading.command, { mode: 'promiseExit' }),
  };
};

const useWorkspaceNav = (props: WorkspaceNavProps) => {
  const sources = useWorkspaceAtoms();
  const feedCommand = useFeedCommand(
    sources.runFeed,
    sources.articles,
    () => sources.mutation().waiting
  );
  useUnreadRefresh(sources.refreshFeeds, sources.refreshUnread);
  createEffect(() => {
    if (props.feedRevision >= 0) sources.refreshFeeds();
  });
  const feedItems = () =>
    Option.getOrUndefined(AsyncResult.value(sources.feeds()))?.items ?? [];
  const feedUnread = () =>
    feedItems().reduce((total, feed) => total + feed.unreadCount, 0);
  const linkUnread = () =>
    Option.getOrUndefined(AsyncResult.value(sources.unread()))?.count;
  const feedBusy = () =>
    sources.mutation().waiting || feedCommand.feedPending() !== undefined;
  const sourceCommand = useSourceCommand({
    runFeed: sources.runFeed,
    runLink: sources.runLink,
    feedBusy,
    linkBusy: () => sources.readingMutation().waiting,
    feedArticles: sources.articles,
    linkArticles: sources.linkArticles,
    rssActive: () => props.scope === 'rss',
  });
  useMissingFeedGuard(sources.feeds, () => props.feedKey, props.onPickFeed);

  return {
    feedItems,
    feedUnread,
    linkUnread,
    feedBusy,
    onlyUnread: sources.data.onlyUnread,
    setOnlyUnread: sources.data.setOnlyUnread,
    ...feedCommand,
    ...sourceCommand,
  };
};

type NavSourceProps = {
  readonly props: WorkspaceNavProps;
  readonly nav: ReturnType<typeof useWorkspaceNav>;
};

const WorkspaceSourceNav = (input: NavSourceProps) => (
  <ul aria-label="阅读来源" class="flex shrink-0 flex-col gap-1">
    <SourceNavRow
      icon="all"
      label="全部文章"
      active={input.props.scope === 'rss' && !input.props.feedKey}
      count={input.nav.feedUnread()}
      busy={input.nav.sourceBusy()}
      onlyUnread={input.nav.onlyUnread()}
      pending={input.nav.sourcePendingLabel('rss')}
      error={input.nav.sourceErrorMessage('rss')}
      onPick={input.props.onPickRss}
      onRefresh={input.nav.refreshRss}
      onMarkAll={input.nav.markAllRss}
      onOnlyUnreadChange={input.nav.setOnlyUnread}
    />
    <SourceNavRow
      icon="bookmark"
      label="稍后阅读"
      active={input.props.scope === 'later'}
      count={input.nav.linkUnread()}
      busy={input.nav.sourceBusy()}
      onlyUnread={input.nav.onlyUnread()}
      pending={input.nav.sourcePendingLabel('later')}
      error={input.nav.sourceErrorMessage('later')}
      onPick={input.props.onPickLater}
      onRefresh={input.nav.refreshLater}
      onMarkAll={input.nav.markAllLater}
      onOnlyUnreadChange={input.nav.setOnlyUnread}
    />
  </ul>
);

const WorkspaceNavView = (input: NavSourceProps) => (
  <nav
    aria-label="阅读导航"
    class={`flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden border-r border-base-300 bg-base-100 px-3 pb-3 ${input.props.class ?? ''}`}
  >
    <header class="mb-2 flex h-13 shrink-0 items-center justify-between gap-2 px-2">
      <h1 class="flex items-center gap-2.5 text-xl font-semibold tracking-[0.08em]">
        <ReaderIcon name="feed" class="size-6 text-brand" />
        留白
      </h1>
      <WorkspaceAccountMenu
        onSettings={input.props.onSettings}
        onManage={input.props.onManage}
      />
    </header>
    <WorkspaceSourceNav props={input.props} nav={input.nav} />
    <div class="mt-5 flex shrink-0 items-center justify-between pl-3 text-xs tracking-[0.06em] text-base-content/60">
      <span>订阅源</span>
      <NavButton
        class="w-9 justify-center"
        aria-label="添加订阅"
        title="添加订阅"
        onClick={input.props.onManage}
      >
        <ReaderIcon name="plus" />
      </NavButton>
    </div>
    <FeedNavList
      activeKey={input.props.feedKey}
      rssActive={input.props.scope === 'rss'}
      feeds={input.nav.feedItems()}
      busy={input.nav.feedBusy()}
      onlyUnread={input.nav.onlyUnread()}
      pending={input.nav.feedPending()}
      error={input.nav.feedError()}
      onPick={input.props.onPickFeed}
      onCommand={input.nav.runFeedCommand}
      onOnlyUnreadChange={input.nav.setOnlyUnread}
    />
  </nav>
);

export const WorkspaceNav = (props: WorkspaceNavProps) => {
  const nav = useWorkspaceNav(props);

  return <WorkspaceNavView props={props} nav={nav} />;
};
