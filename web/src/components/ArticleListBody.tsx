import type { JSX } from '@solidjs/web';
import {
  createEffect,
  createMemo,
  createProjection,
  onCleanup,
  Show,
} from 'solid-js';
import {
  articleById,
  feedIconCandidates,
  feedIdOf,
  feeds,
  groupStartIds,
  type LibraryScope,
  requestWindow,
  setVisibleRange,
} from '../state';
import { VirtualList } from '../ui';
import { ArticleRow } from './ArticleRow';
import { SiteIcon } from './SiteIcon';

export interface ArticleListBodyProps {
  /** Ordered article IDs of the snapshot. */
  ids: ReadonlyArray<string>;
  scope: LibraryScope;
  unreadOnly: boolean;
  openArticleId: string | null;
  onNavigate: (url: string) => void;
}

const SKELETON_HEIGHT = 136;
const GROUP_LABEL_HEIGHT = 32;

type SidebarFeed = ReturnType<typeof feeds>[number];

function FeedGroupLabel(props: { feed: SidebarFeed }): JSX.Element {
  return (
    <div
      class="flex items-center gap-1.5 px-3 pt-2 text-xs font-semibold text-base-content/50"
      style={{ height: `${GROUP_LABEL_HEIGHT}px` }}
    >
      <SiteIcon
        srcs={feedIconCandidates(props.feed)}
        fallback="rss"
        size={14}
      />
      <span class="min-w-0 flex-1 truncate">{props.feed.title}</span>
    </div>
  );
}

function ArticleRowSkeleton(props: { grouped: boolean }): JSX.Element {
  return (
    <div
      aria-busy="true"
      class="overflow-hidden px-2 py-0.5"
      style={{ height: `${SKELETON_HEIGHT}px` }}
    >
      <div
        aria-hidden="true"
        class="flex items-start gap-1 rounded-box pt-2 pr-3 pb-2.5 pl-1"
      >
        <div class="flex size-5 shrink-0 items-center justify-center mt-6 pointer-coarse:mt-4.5 pointer-coarse:size-8">
          <div class="skeleton size-2 rounded-full" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex h-4 items-center justify-between gap-2">
            <Show when={!props.grouped}>
              <div class="skeleton h-3 w-1/3" />
            </Show>
            <div class="skeleton ml-auto h-3 w-10" />
          </div>
          <div class="flex flex-col gap-1 py-0.5">
            <div class="skeleton h-4 w-11/12" />
            <div class="skeleton h-4 w-2/3" />
          </div>
          <div class="flex flex-col gap-1 pt-0.5">
            <div class="skeleton h-3 w-full" />
            <div class="skeleton h-3 w-11/12" />
            <div class="skeleton h-3 w-4/5" />
          </div>
        </div>
      </div>
    </div>
  );
}

const CachedArticleRow = (
  props: Pick<ArticleListBodyProps, 'scope' | 'unreadOnly' | 'onNavigate'> & {
    id: string;
    selected: boolean;
    groupFeed: SidebarFeed | undefined;
  }
): JSX.Element => {
  const grouped = () =>
    props.scope.kind === 'all' || props.scope.kind === 'folder';

  return (
    <>
      <Show when={props.groupFeed}>
        {(feed) => <FeedGroupLabel feed={feed()} />}
      </Show>
      <Show
        when={articleById(props.id)}
        fallback={<ArticleRowSkeleton grouped={grouped()} />}
      >
        {(row) => (
          <ArticleRow
            row={row()}
            scope={props.scope}
            unreadOnly={props.unreadOnly}
            active={props.selected}
            onNavigate={props.onNavigate}
          />
        )}
      </Show>
    </>
  );
};

const useArticleWindow = (ids: () => ReadonlyArray<string>) => {
  let rendered = { start: 0, end: -1 };
  let disposed = false;
  let scheduled = false;
  const schedule = (): void => {
    if (scheduled) return;

    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!disposed) requestWindow(rendered);
    });
  };
  createEffect(ids, schedule);
  onCleanup(() => {
    disposed = true;
    setVisibleRange(null);
    queueMicrotask(() => requestWindow({ start: 0, end: -1 }));
  });

  return (
    range: typeof rendered,
    visible: Parameters<typeof setVisibleRange>[0]
  ): void => {
    rendered = range;
    setVisibleRange(visible);
    schedule();
  };
};

const useGroupFeeds = (props: ArticleListBodyProps) =>
  createMemo(
    () => {
      const groups = new Map<string, SidebarFeed>();
      if (props.scope.kind !== 'all' && props.scope.kind !== 'folder')
        return groups;

      const byId = new Map(
        feeds()
          .filter((feed) => feed.title)
          .map((feed) => [feed.id, feed])
      );
      for (const id of groupStartIds()) {
        const feed = byId.get(feedIdOf(id) ?? '');
        if (feed !== undefined) groups.set(id, feed);
      }

      return groups;
    },
    { name: 'articleListGroupFeeds' }
  );
/** `LIB-VIEW-1`: virtualized snapshot rows read cached records by ID. */
export function ArticleListBody(props: ArticleListBodyProps): JSX.Element {
  const activeIndex = (): number =>
    props.openArticleId === null ? -1 : props.ids.indexOf(props.openArticleId);
  const reportRange = useArticleWindow(() => props.ids);
  const groupFeeds = useGroupFeeds(props);
  const estimateSize = createMemo(
    () => {
      const groups = groupFeeds();
      return (id: string) =>
        SKELETON_HEIGHT + (groups.has(id) ? GROUP_LABEL_HEIGHT : 0);
    },
    { name: 'articleListEstimateSize' }
  );
  const active = createProjection<Record<string, boolean>>((draft) => {
    const openId = props.openArticleId;
    for (const id of Object.keys(draft)) {
      if (id !== openId) delete draft[id];
    }
    if (openId !== null) draft[openId] = true;
  }, {});

  return (
    <VirtualList
      keys={props.ids}
      estimateSize={estimateSize()}
      activeKey={props.openArticleId}
      activeIndex={activeIndex()}
      onRangeChange={reportRange}
      class="min-h-0 flex-1"
      renderItem={(id) => (
        <CachedArticleRow
          id={id}
          scope={props.scope}
          unreadOnly={props.unreadOnly}
          selected={active[id] === true}
          groupFeed={groupFeeds().get(id)}
          onNavigate={props.onNavigate}
        />
      )}
    />
  );
}
