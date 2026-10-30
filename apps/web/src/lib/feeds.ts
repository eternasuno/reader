import type { FeedArticle } from '@reader/api';
import { Effect } from 'effect';
import { Atom } from 'effect/reactivity';
import { errorText } from './errors';
import {
  appendPage,
  applyLoadedRead,
  applyReadAll,
  beginLoad,
  beginReset,
  failLoad,
  type InfiniteState,
  initialInfiniteState,
  type PageCursor,
} from './infinite';
import { LinksClient, LinksClientLive } from './links';
import { markLoadedKeys } from './mark-loaded';

export type FeedCommand =
  | { readonly _tag: 'Subscribe'; readonly token: string }
  | { readonly _tag: 'Unsubscribe' | 'Save'; readonly key: string }
  | {
      readonly _tag: 'Refresh';
      readonly key: string;
      readonly reload?: boolean;
    }
  | { readonly _tag: 'RefreshAll'; readonly reload?: boolean }
  | { readonly _tag: 'Mark'; readonly key: string; readonly read: boolean }
  | { readonly _tag: 'MarkAll'; readonly key: string }
  | {
      readonly _tag: 'MarkLoaded';
      readonly keys: readonly string[];
      readonly generation: number;
    };

export type FeedQuery = {
  readonly feedKey: string;
  readonly onlyUnread: boolean;
};

type LoadInput = { readonly reset: boolean };

type FeedState = {
  readonly articles: Atom.Writable<InfiniteState<FeedArticle>>;
  readonly query: Atom.Writable<FeedQuery>;
};

type FeedCommandState = FeedState & {
  readonly refreshFeeds: () => void;
  readonly resetArticles: () => void;
};

const feedKey = (item: FeedArticle) => item.key;

const feedCursor = (item: FeedArticle): PageCursor => ({
  before: item.publishedAt,
  beforeKey: item.key,
});

const listPage = (
  client: LinksClient['Service'],
  query: FeedQuery,
  cursor: PageCursor | undefined
) =>
  client.feeds.articles({
    query: {
      feedKey: query.feedKey,
      read: false,
      all: !query.onlyUnread,
      offset: 0,
      ...(cursor ?? {}),
    },
  });

const previewFeed = (url: string) =>
  Effect.gen(function* () {
    const client = yield* LinksClient;
    const result = yield* client.feeds.preview({ payload: { url } });

    return result.preview;
  });

const runFeedLoad = (
  input: LoadInput,
  get: Atom.FnContext,
  context: FeedState
) =>
  Effect.gen(function* () {
    const client = yield* LinksClient;
    const before = get(context.articles);
    const generation = input.reset ? before.generation + 1 : before.generation;
    const next = input.reset ? beginReset(before) : beginLoad(before);

    if (next === before) {
      return before;
    }

    get.set(context.articles, next);
    const page = yield* listPage(client, get(context.query), next.cursor).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          get.set(
            context.articles,
            failLoad(get(context.articles), errorText(error), generation)
          );
        })
      )
    );
    const applied = appendPage(
      get(context.articles),
      page,
      feedKey,
      feedCursor,
      generation
    );
    get.set(context.articles, applied);

    return applied;
  });

const markAllArticles = (
  key: string,
  get: Atom.FnContext,
  context: FeedCommandState
) =>
  Effect.gen(function* () {
    const client = yield* LinksClient;
    yield* client.feeds.markAll({ payload: { feedKey: key } });
    const current = get(context.query);
    const completeScope = key === '' || current.feedKey === key;
    get.set(
      context.articles,
      applyReadAll(
        get(context.articles),
        current.onlyUnread,
        (item) => key === '' || item.feedKey === key,
        completeScope
      )
    );
    context.refreshFeeds();
  });

const runFeedRefresh = (reload: boolean, context: FeedCommandState) => {
  context.refreshFeeds();
  if (reload) context.resetArticles();
};

const runFeedMutation = (
  input: Exclude<
    FeedCommand,
    { readonly _tag: 'Mark' | 'MarkAll' | 'MarkLoaded' }
  >,
  get: Atom.FnContext,
  context: FeedCommandState
) =>
  Effect.gen(function* () {
    const client = yield* LinksClient;

    if (input._tag === 'Save') {
      yield* client.feeds.save({ payload: { key: input.key } });

      return;
    }

    if (input._tag === 'Refresh' || input._tag === 'RefreshAll') {
      runFeedRefresh(input.reload === true, context);

      return;
    }

    if (input._tag === 'Subscribe') {
      yield* client.feeds.subscribe({ payload: { token: input.token } });
      context.refreshFeeds();
      context.resetArticles();

      return;
    }

    yield* client.feeds.unsubscribe({ payload: { key: input.key } });
    context.refreshFeeds();
    if (get(context.query).feedKey === '') context.resetArticles();
  });

const markLoadedArticles = (
  input: Extract<FeedCommand, { readonly _tag: 'MarkLoaded' }>,
  get: Atom.FnContext,
  context: FeedCommandState
) =>
  Effect.gen(function* () {
    if (input.keys.length === 0) return { keys: [], failed: false, error: '' };

    const client = yield* LinksClient;
    const result = yield* markLoadedKeys(input.keys, (keys) =>
      client.feeds.markLoaded({ payload: { keys } })
    );
    get.set(
      context.articles,
      applyLoadedRead(
        get(context.articles),
        result.keys,
        feedKey,
        input.generation
      )
    );
    context.refreshFeeds();

    return result;
  });

const runFeedCommand = (
  input: FeedCommand,
  get: Atom.FnContext,
  context: FeedCommandState
) =>
  Effect.gen(function* () {
    const client = yield* LinksClient;

    if (input._tag === 'Mark') {
      yield* client.feeds.mark({
        payload: { key: input.key, read: input.read },
      });

      return;
    }

    if (input._tag === 'MarkAll') {
      yield* markAllArticles(input.key, get, context);

      return;
    }

    if (input._tag === 'MarkLoaded') {
      return yield* markLoadedArticles(input, get, context);
    }

    yield* runFeedMutation(input, get, context);
  });

export const makeFeedAtoms = (layer = LinksClientLive) => {
  const runtime = Atom.runtime(layer);
  const query = Atom.make<FeedQuery>({ feedKey: '', onlyUnread: true });
  const feeds = runtime.atom(() =>
    Effect.flatMap(LinksClient, (client) => client.feeds.list())
  );
  const articles = Atom.make(initialInfiniteState<FeedArticle>());
  const load = runtime.fn<LoadInput>()(
    Effect.fnUntraced(function* (input, get) {
      return yield* runFeedLoad(input, get, { articles, query });
    }),
    { concurrent: true }
  );
  const preview = runtime.fn<string>()((url) => previewFeed(url));
  const command = runtime.fn<FeedCommand>()(
    Effect.fnUntraced(function* (input, get) {
      return yield* runFeedCommand(input, get, {
        articles,
        query,
        refreshFeeds: () => get.refresh(feeds),
        resetArticles: () => get.set(load, { reset: true }),
      });
    })
  );

  return { query, feeds, articles, load, preview, command };
};
