import { ReaderApi, type ReadingLink } from '@reader/api';
import { Context, Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
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
  prependLoaded,
  removeLoaded,
} from './infinite';
import { markLoadedKeys } from './mark-loaded';

export type { LinkPage, ReadingLink } from '@reader/api';

export class LinksClient extends Context.Service<
  LinksClient,
  HttpApiClient.ForApi<typeof ReaderApi>
>()('reader/LinksClient') {}

export const LinksClientLive = Layer.effect(
  LinksClient,
  HttpApiClient.make(ReaderApi, {
    baseUrl: globalThis.location?.origin ?? 'http://localhost',
  })
).pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(
    Layer.succeed(FetchHttpClient.RequestInit, { credentials: 'include' })
  )
);

export type LinkCommand =
  | { readonly _tag: 'Add'; readonly url: string }
  | { readonly _tag: 'Mark'; readonly key: string; readonly read: boolean }
  | { readonly _tag: 'Delete'; readonly key: string }
  | { readonly _tag: 'MarkAll' }
  | {
      readonly _tag: 'MarkLoaded';
      readonly keys: readonly string[];
      readonly generation: number;
    };

type LoadInput = { readonly reset: boolean };

type LinkState = {
  readonly state: Atom.Writable<InfiniteState<ReadingLink>>;
  readonly query: Atom.Writable<boolean>;
};

type LinkCommandState = LinkState & {
  readonly refreshUnread: () => void;
};

const linkKey = (item: { readonly key: string }) => item.key;

const linkCursor = (item: {
  readonly key: string;
  readonly createdAt: string;
}): PageCursor => ({
  before: item.createdAt,
  beforeKey: item.key,
});

const listPage = (
  client: LinksClient['Service'],
  onlyUnread: boolean,
  cursor: PageCursor | undefined
) =>
  client.links.list({
    query: {
      read: false,
      all: !onlyUnread,
      offset: 0,
      ...(cursor ?? {}),
    },
  });

const runLinkLoad = (
  input: LoadInput,
  get: Atom.FnContext,
  context: LinkState
) =>
  Effect.gen(function* () {
    const client = yield* LinksClient;
    const before = get(context.state);
    const generation = input.reset ? before.generation + 1 : before.generation;
    const next = input.reset ? beginReset(before) : beginLoad(before);

    if (next === before) {
      return before;
    }

    get.set(context.state, next);
    const page = yield* listPage(client, get(context.query), next.cursor).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          get.set(
            context.state,
            failLoad(get(context.state), errorText(error), generation)
          );
        })
      )
    );
    const applied = appendPage(
      get(context.state),
      page,
      linkKey,
      linkCursor,
      generation
    );
    get.set(context.state, applied);

    return applied;
  });

const markLoadedLinks = (
  input: Extract<LinkCommand, { readonly _tag: 'MarkLoaded' }>,
  get: Atom.FnContext,
  context: LinkCommandState
) =>
  Effect.gen(function* () {
    if (input.keys.length === 0) return { keys: [], failed: false, error: '' };

    const client = yield* LinksClient;
    const result = yield* markLoadedKeys(input.keys, (keys) =>
      client.links.markLoaded({ payload: { keys } })
    );
    get.set(
      context.state,
      applyLoadedRead(
        get(context.state),
        result.keys,
        linkKey,
        input.generation
      )
    );
    context.refreshUnread();

    return result;
  });

const runLinkCommand = (
  input: LinkCommand,
  get: Atom.FnContext,
  context: LinkCommandState
) =>
  Effect.gen(function* () {
    const client = yield* LinksClient;

    if (input._tag === 'Mark') {
      yield* client.links.mark({
        payload: { key: input.key, read: input.read },
      });

      return;
    }

    if (input._tag === 'MarkLoaded') {
      return yield* markLoadedLinks(input, get, context);
    }

    if (input._tag === 'MarkAll') {
      yield* client.links.markAll({ payload: {} });
      get.set(
        context.state,
        applyReadAll(get(context.state), get(context.query), () => true, true)
      );
      context.refreshUnread();

      return;
    }

    if (input._tag === 'Add') {
      const result = yield* client.links.add({
        payload: { url: input.url },
      });
      get.set(
        context.state,
        prependLoaded(get(context.state), result.item, linkKey)
      );
      context.refreshUnread();

      return;
    }

    yield* client.links.remove({ payload: { key: input.key } });
    get.set(
      context.state,
      removeLoaded(get(context.state), input.key, linkKey)
    );
    context.refreshUnread();
  });

export const makeReadingAtoms = (layer = LinksClientLive) => {
  const runtime = Atom.runtime(layer);
  const query = Atom.make(true);
  const state = Atom.make(initialInfiniteState<ReadingLink>());
  const unread = runtime.atom(() =>
    Effect.flatMap(LinksClient, (client) => client.links.unreadCount())
  );
  const load = runtime.fn<LoadInput>()(
    Effect.fnUntraced(function* (input, get) {
      return yield* runLinkLoad(input, get, { state, query });
    }),
    { concurrent: true }
  );
  const command = runtime.fn<LinkCommand>()(
    Effect.fnUntraced(function* (input, get) {
      return yield* runLinkCommand(input, get, {
        state,
        query,
        refreshUnread: () => get.refresh(unread),
      });
    })
  );

  return { query, state, unread, load, command };
};
