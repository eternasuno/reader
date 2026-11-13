import type { LibraryApi } from '@reader/api';
import {
  type ActiveFetcher,
  activeFetcher,
  OwnerId,
  SettingRepository,
  type WebpageFetcher,
} from '@reader/business';
import {
  BrowserWebpageFetcherLive,
  JinaWebpageFetcherLive,
} from '@reader/webpage';
import { Effect, type Layer, Option, Redacted } from 'effect';
import type { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Session } from '../middleware/session';

type Groups =
  typeof LibraryApi extends HttpApi.HttpApi<string, infer G> ? G : never;

type Group = HttpApiGroup.WithIdentifier<Groups, 'library'>;

type LibraryEndpoints = Group['endpoints'];

export type HandlerRequest<Identifier extends keyof LibraryEndpoints> =
  Parameters<
    HttpApiEndpoint.Handler<LibraryEndpoints[Identifier], never, never>
  >[0];

const withSession = <A, E, R>(
  use: (owner: OwnerId) => Effect.Effect<A, E, R>
) => Effect.flatMap(Session, (user) => use(OwnerId.make(user.id)));

type FailureTable = Record<
  string,
  (error: never) => Effect.Effect<never, unknown>
>;

type HandledErrors<Table> = {
  readonly [Tag in keyof Table]: Table[Tag] extends (
    error: never
  ) => Effect.Effect<never, infer Err>
    ? Err
    : never;
}[keyof Table];

type UnhandledErrors<Err> = Exclude<Err, { readonly _tag: string }>;

/**
 * Runs a library handler and reports the endpoint errors its failure table
 * maps to.
 *
 * `Effect.catchTags` derives its error type from its case table, and that
 * derivation does not survive a generic wrapper, so the overload states the
 * handled errors instead while the implementation stays loose. Endpoint errors
 * are still checked: the declared error union is the union of the failure
 * table's errors, so a table that misses or invents a tag fails to type-check
 * against the endpoint.
 */
export function handle<A, Err, R, Table extends FailureTable>(
  failures: Table,
  use: (owner: OwnerId) => Effect.Effect<A, Err, R>
): Effect.Effect<A, HandledErrors<Table> | UnhandledErrors<Err>, R | Session>;
export function handle(
  failures: FailureTable,
  use: (owner: OwnerId) => Effect.Effect<unknown, unknown, unknown>
): Effect.Effect<unknown, unknown, unknown> {
  return withSession(use).pipe(Effect.catchTags(failures as never));
}

/** `handle` for the handlers that only report success. */
export function handleOk<Err, R, Table extends FailureTable>(
  failures: Table,
  use: (owner: OwnerId) => Effect.Effect<unknown, Err, R>
): Effect.Effect<
  { readonly ok: true },
  HandledErrors<Table> | UnhandledErrors<Err>,
  R | Session
>;
export function handleOk(
  failures: FailureTable,
  use: (owner: OwnerId) => Effect.Effect<unknown, unknown, unknown>
): Effect.Effect<unknown, unknown, unknown> {
  return handle(failures, (owner) =>
    Effect.as(use(owner), { ok: true as const })
  );
}

export const optionToNull = <A>(value: Option.Option<A>): A | null =>
  Option.match(value, {
    onNone: () => null,
    onSome: (item) => item,
  });

const webpageFetcherLayer = (
  fetcher: ActiveFetcher
): Layer.Layer<WebpageFetcher> => {
  switch (fetcher._tag) {
    case 'Browser':
      return BrowserWebpageFetcherLive(Redacted.value(fetcher.endpoint).href);
    case 'Jina':
      return JinaWebpageFetcherLive(Option.getOrUndefined(fetcher.key));
  }
};

export const fetcherFor = (owner: OwnerId) =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const setting = yield* settings.get(owner);
    const fetcher = yield* activeFetcher(setting);

    return webpageFetcherLayer(fetcher);
  });
