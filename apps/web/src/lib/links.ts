import { ReaderApi } from '@reader/api';
import { Context, Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { Atom } from 'effect/reactivity';

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
  | { readonly _tag: 'Delete'; readonly key: string };

export const makeReadingAtoms = (layer = LinksClientLive) => {
  const runtime = Atom.runtime(layer);
  const query = Atom.make({ read: false, page: 0 });
  const page = runtime.atom((get) => {
    const current = get(query);

    return Effect.flatMap(LinksClient, (client) =>
      client.links.list({
        query: { read: current.read, offset: current.page * 30 },
      })
    );
  });
  const command = runtime.fn<LinkCommand>()(
    Effect.fnUntraced(function* (input, get) {
      const client = yield* LinksClient;

      if (input._tag === 'Add') {
        yield* client.links.add({ payload: { url: input.url } });
        get.set(query, { read: false, page: 0 });
      } else if (input._tag === 'Mark') {
        yield* client.links.mark({
          payload: { key: input.key, read: input.read },
        });
      } else {
        yield* client.links.remove({ payload: { key: input.key } });
      }

      get.refresh(page);
      const result = yield* get.result(page, { suspendOnWaiting: true });
      const current = get(query);

      if (result.items.length === 0 && current.page > 0) {
        get.set(query, { ...current, page: current.page - 1 });
      }
    })
  );

  return { query, page, command };
};
