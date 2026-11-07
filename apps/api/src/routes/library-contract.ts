import type { LibraryApi } from '@reader/api';
import {
  InvalidCursor,
  type ListCursor,
  ListCursorFromString,
  OwnerId,
  type Setting,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import type { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import {
  browserWebpageFetcherLive,
  jinaWebpageFetcherLive,
} from '../adapter/webpage-fetcher';
import { Session } from '../middleware/session';

type Groups =
  typeof LibraryApi extends HttpApi.HttpApi<string, infer G> ? G : never;

type Group = HttpApiGroup.WithIdentifier<Groups, 'library'>;

export type LibraryEndpoints = Group['endpoints'];

export type HandlerRequest<Identifier extends keyof LibraryEndpoints> =
  Parameters<
    HttpApiEndpoint.Handler<LibraryEndpoints[Identifier], never, never>
  >[0];

export const withSession = <A, E, R>(
  use: (owner: OwnerId) => Effect.Effect<A, E, R>
) => Effect.flatMap(Session, (user) => use(OwnerId.make(user.id)));

export const optionToNull = <A>(value: Option.Option<A>): A | null =>
  Option.match(value, {
    onNone: () => null,
    onSome: (item) => item,
  });

const invalidCursor = () =>
  new InvalidCursor({ message: 'Invalid pagination cursor' });

export const cursor = (
  value: string
): Effect.Effect<ListCursor, InvalidCursor> =>
  Schema.decodeEffect(ListCursorFromString)(value).pipe(
    Effect.mapError(invalidCursor)
  );

export const optionalCursor = (
  value: Option.Option<string>
): Effect.Effect<ListCursor | undefined, InvalidCursor> =>
  Option.match(value, {
    onNone: () => Effect.succeed(undefined),
    onSome: cursor,
  });

export const webpageFetcherLayerFor = (config: Setting) =>
  config.fetcher.provider === 'jina'
    ? jinaWebpageFetcherLive(Option.getOrUndefined(config.fetcher.jina.key))
    : browserWebpageFetcherLive(
        Option.getOrUndefined(config.fetcher.browser.endpoint)
      );
