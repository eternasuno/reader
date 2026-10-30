import {
  useAtom,
  useAtomMount,
  useAtomSet,
  useAtomValue,
} from '@effect/atom-solid/Hooks';
import type { FeedArticle } from '@reader/api';
import { type Exit, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { createEffect, createSignal, on, Show, untrack } from 'solid-js';
import { resultError } from '../../lib/errors';
import type { FeedCommand } from '../../lib/feeds';
import type { MarkLoadedResult } from '../../lib/mark-loaded';
import { useInfiniteLoader } from '../../pages/infinite-loader';
import { useWorkspaceData } from '../../pages/workspace-state';
import { FeedArticles } from '../molecules/feed-entries';
import { ListToolbar } from '../molecules/list-toolbar';
import { useFeedSubscription } from './feed-subscription';
import { FeedManagement } from './feed-subscriptions';
import {
  createReadStatusProjection,
  feedBulkScope,
  hasUnread,
  notifyReaderDataChanged,
  publishBulkReadStatus,
  publishReadStatus,
  publishReadStatuses,
  unreadKeys,
} from './reader-status';

type RunFeed = (
  input: FeedCommand
) => Promise<Exit.Exit<MarkLoadedResult | undefined, unknown>>;

const publishMark = async (run: RunFeed, key: string, read: boolean) => {
  const exit = await run({ _tag: 'Mark', key, read });
  publishReadStatus(exit, { kind: 'feed', key, read });

  return exit;
};

const publishMarkAll = async (
  run: RunFeed,
  key: string,
  items: readonly FeedArticle[]
) => {
  const exit = await run({ _tag: 'MarkAll', key });
  if (exit._tag === 'Success') {
    publishBulkReadStatus(exit, {
      kind: 'feed',
      keys: items
        .filter((item) => key === '' || item.feedKey === key)
        .map((item) => item.key),
      read: true,
      scope: feedBulkScope(key),
    });
  }

  return exit;
};

const saveFeedArticle = (
  run: RunFeed,
  setNotice: (value: string) => void,
  key: string
) => {
  setNotice('');

  return run({ _tag: 'Save', key }).then((exit) => {
    if (exit._tag === 'Success') setNotice('已保存到稍后读');
  });
};

const useFeedSource = () => {
  const data = useWorkspaceData();
  const [query, setQuery] = useAtom(() => data.feeds.query);
  const feeds = useAtomValue(() => data.feeds.feeds);
  const articles = useAtomValue(() => data.feeds.articles);
  const mutation = useAtomValue(() => data.feeds.command);
  const rawRun = useAtomSet(() => data.feeds.command, { mode: 'promiseExit' });
  const rawPreview = useAtomSet(() => data.feeds.preview, {
    mode: 'promiseExit',
  });
  const load = useAtomSet(() => data.feeds.load, { mode: 'promiseExit' });
  useAtomMount(() => data.feeds.load);
  const items = createReadStatusProjection('feed', () => articles().items);
  const pending = () => mutation().waiting;
  const loader = useInfiniteLoader(articles, pending, (reset) =>
    load({ reset })
  );

  return {
    data,
    query,
    setQuery,
    feeds,
    articles,
    mutation,
    rawRun,
    rawPreview,
    items,
    pending,
    ...loader,
  };
};

const useFeedActions = (source: ReturnType<typeof useFeedSource>) => {
  const [notice, setNotice] = createSignal('');
  const [markError, setMarkError] = createSignal('');
  const run = async (input: FeedCommand) => {
    const exit = await source.rawRun(input);
    if (exit._tag === 'Success' && input._tag === 'Save') {
      notifyReaderDataChanged();
    }

    return exit;
  };
  const mark = (key: string, read: boolean) => {
    if (source.pending()) return Promise.resolve(undefined);

    return publishMark(source.rawRun, key, read);
  };
  const markAll = (key: string) => {
    if (source.pending()) return Promise.resolve(undefined);

    return publishMarkAll(source.rawRun, key, source.items() ?? []);
  };
  const markLoaded = async () => {
    if (source.pending()) return;

    const keys = unreadKeys(source.items());
    if (keys.length === 0) return;

    setMarkError('');
    const exit = await source.rawRun({
      _tag: 'MarkLoaded',
      keys,
      generation: source.articles().generation,
    });
    if (exit._tag === 'Success' && exit.value) {
      publishReadStatuses(exit, 'feed', exit.value.keys);
      setMarkError(exit.value.error);
    }
  };
  const refresh = async () => {
    if (source.pending()) return;

    await source.rawRun({ _tag: 'RefreshAll', reload: true });
  };
  const save = (key: string) => saveFeedArticle(run, setNotice, key);

  return {
    notice,
    markError,
    mark,
    markAll,
    markLoaded,
    refresh,
    save,
  };
};

const useFeeds = () => {
  const source = useFeedSource();

  return {
    ...source,
    ...useFeedActions(source),
    ...useFeedSubscription(source.rawRun, source.rawPreview),
  };
};

export type FeedReaderModel = ReturnType<typeof useFeeds>;

export type FeedReaderProps = {
  readonly active?: boolean | undefined;
  readonly onItems?: ((items: readonly FeedArticle[]) => void) | undefined;
  readonly onSelect?: ((item: FeedArticle) => void) | undefined;
  readonly selectedKey?: string | undefined;
  readonly feedKey?: string | undefined;
  readonly management?: boolean | undefined;
};

const useFeedReader = (props: FeedReaderProps) => {
  const data = useWorkspaceData();
  const model = useFeeds();
  const loaded = () => model.items();
  let published: readonly FeedArticle[] | undefined;
  createEffect(() => {
    const items = loaded();
    if (items && items !== published) {
      published = items;
      untrack(() => props.onItems?.(items));
    }
  });
  if (!props.management) {
    createEffect(
      on(
        () =>
          [
            props.feedKey ?? '',
            data.onlyUnread(),
            props.active ?? true,
          ] as const,
        ([feedKey, onlyUnread, active]) => {
          model.setQuery({ feedKey, onlyUnread });
          if (active) model.reload();
        }
      )
    );
  }
  const feeds = () =>
    Option.getOrUndefined(AsyncResult.value(model.feeds()))?.items;
  const feedKey = () => props.feedKey ?? '';
  const feedTitle = () => {
    if (!feedKey()) return '全部文章';

    return feeds()?.find((feed) => feed.key === feedKey())?.title ?? '订阅文章';
  };
  const unread = () => {
    const items = feeds();
    if (!items) return undefined;
    if (!feedKey())
      return items.reduce((total, feed) => total + feed.unreadCount, 0);

    return items.find((feed) => feed.key === feedKey())?.unreadCount;
  };
  const managing = () => props.management === true;
  const loadedUnread = () => hasUnread(model.items());

  return { model, feeds, feedTitle, unread, managing, loadedUnread };
};

export const FeedReader = (props: FeedReaderProps) => {
  const view = useFeedReader(props);

  return <FeedReaderContent view={view} props={props} />;
};

type FeedReaderView = ReturnType<typeof useFeedReader>;

const FeedReaderContent = (input: {
  readonly view: FeedReaderView;
  readonly props: FeedReaderProps;
}) => {
  const { model, feedTitle, unread, managing, loadedUnread } = input.view;

  return (
    <Show
      when={managing()}
      fallback={
        <div class="flex h-full min-h-0 flex-col">
          <ListToolbar
            title={feedTitle()}
            unread={unread()}
            loadedUnread={loadedUnread()}
            onlyUnread={model.query().onlyUnread}
            pending={model.pending()}
            error={resultError(model.mutation()) || model.markError()}
            onRefresh={() => void model.refresh()}
            onMarkAll={() => void model.markAll(input.props.feedKey ?? '')}
            onMarkLoaded={() => void model.markLoaded()}
            onOnlyUnreadChange={model.data.setOnlyUnread}
          />
          <FeedArticles
            model={model}
            active={input.props.active ?? true}
            onSelect={input.props.onSelect}
            selectedKey={input.props.selectedKey}
          />
        </div>
      }
    >
      <FeedManagement model={model} />
    </Show>
  );
};
