import { Effect } from 'effect';
import { Atom } from 'effect/reactivity';
import { LinksClient, LinksClientLive } from './links';

export type FeedCommand =
  | { readonly _tag: 'Subscribe'; readonly url: string }
  | { readonly _tag: 'Unsubscribe' | 'Refresh' | 'Save'; readonly key: string }
  | { readonly _tag: 'Mark'; readonly key: string; readonly read: boolean };

type FeedQuery = {
  feedKey: string;
  read: boolean;
  page: number;
};

const pageSize = 30;

const resetFeedQuery: FeedQuery = { feedKey: '', read: false, page: 0 };

const feedQueryParams = (current: FeedQuery) => ({
  feedKey: current.feedKey,
  read: current.read,
  offset: current.page * pageSize,
});

const runFeedMutation = (
  client: LinksClient['Service'],
  input: FeedCommand
) => {
  if (input._tag === 'Subscribe') {
    return client.feeds.subscribe({ payload: { url: input.url } });
  }
  if (input._tag === 'Unsubscribe') {
    return client.feeds.unsubscribe({ payload: { key: input.key } });
  }
  if (input._tag === 'Refresh') {
    return client.feeds.refresh({ payload: { key: input.key } });
  }
  if (input._tag === 'Mark') {
    return client.feeds.mark({
      payload: { key: input.key, read: input.read },
    });
  }
  return client.feeds.save({ payload: { key: input.key } });
};

const resetQueryOnUnsubscribe = (
  get: Atom.FnContext,
  query: Atom.Writable<FeedQuery>,
  input: FeedCommand
) => {
  if (input._tag === 'Unsubscribe') {
    get.set(query, resetFeedQuery);
  }
};

const stepBackWhenEmpty = (
  get: Atom.FnContext,
  query: Atom.Writable<FeedQuery>,
  length: number
) => {
  const current = get(query);
  if (length === 0 && current.page > 0) {
    get.set(query, { ...current, page: current.page - 1 });
  }
};

export const makeFeedAtoms = (layer = LinksClientLive) => {
  const runtime = Atom.runtime(layer);
  const query = Atom.make<FeedQuery>({ feedKey: '', read: false, page: 0 });
  const feeds = runtime.atom(() =>
    Effect.flatMap(LinksClient, (client) => client.feeds.list())
  );
  const articles = runtime.atom((get) => {
    const current = get(query);
    return Effect.flatMap(LinksClient, (client) =>
      client.feeds.articles({ query: feedQueryParams(current) })
    );
  });
  const command = runtime.fn<FeedCommand>()(
    Effect.fnUntraced(function* (input, get) {
      const client = yield* LinksClient;
      yield* runFeedMutation(client, input);
      if (input._tag === 'Mark') return;

      resetQueryOnUnsubscribe(get, query, input);
      get.refresh(feeds);
      get.refresh(articles);
      const page = yield* get.result(articles, { suspendOnWaiting: true });
      stepBackWhenEmpty(get, query, page.items.length);
    })
  );

  return { query, feeds, articles, command };
};
