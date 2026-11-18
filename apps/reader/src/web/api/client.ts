/**
 * The one place Effect meets the browser: the client derived from `ReaderApi`
 * (same origin, cookies included) and `request`/`requestJson`, which run one
 * call and resolve its wire value. Every function of `api/` returns a Promise
 * and rejects with `ApiFailure` (`./failure`); `messageOf` (`./messages`) turns
 * one into its Chinese wording, and `onUnauthorized` registers the reaction to
 * a 401.
 */
import { Cause, Effect, Exit, Option, Schema } from 'effect';
import { FetchHttpClient, HttpClientError } from 'effect/http';
import { HttpApiClient, type HttpApiEndpoint } from 'effect/http-api';
import { ReaderApi } from '../../contract';
import { ApiFailure, type ApiFailureTag, detailOf, tagOf } from './failure';
import { isApiFailureTag } from './messages';

/** The client shape the contract derives: one method per endpoint. */
export type ReaderClient = HttpApiClient.ForApi<typeof ReaderApi>;

/**
 * `Schema.toCodecJson` encodes `Date` (`DateTimeUtcFromDate`) to an ISO string,
 * while its static `Encoded` type widens to `Schema.Json`. Mapping `Date` to
 * `string` on the endpoint schema's `Encoded` keeps the exact struct shape of
 * the wire JSON.
 */
type WireJson<T> = T extends Date
  ? string
  : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<WireJson<U>>
    : T extends object
      ? { readonly [K in keyof T]: WireJson<T[K]> }
      : T;

export type EndpointWithSuccess = HttpApiEndpoint.Constraint & {
  readonly success: ReadonlySet<Schema.Top>;
  readonly '~Success': Schema.Constraint & { readonly EncodingServices: never };
};

/** The wire (JSON) form of an endpoint's success schema. */
export type EncodedSuccess<Endpoint extends EndpointWithSuccess> =
  Endpoint['~Success'] extends { readonly schema: infer S }
    ? WireJson<Schema.Codec.Encoded<S>>
    : never;

/** Used where the browser origin is missing, so a request URL stays absolute. */
const fallbackOrigin = 'http://localhost';

const browserOrigin = (): string =>
  (globalThis as { readonly location?: { readonly origin: string } }).location
    ?.origin ?? fallbackOrigin;

/** Cookies go with every request and no response is reused (AC-SESSION-3). */
const requestInit: RequestInit = {
  credentials: 'include',
  cache: 'no-store',
};

/**
 * The browser's `fetch`, read at request time: the client is built once, so the
 * transport is provided per request rather than captured by its layer.
 */
const browserFetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, init);

let client: ReaderClient | undefined;

const readerClient = (): ReaderClient => {
  client ??= Effect.runSync(
    HttpApiClient.make(ReaderApi, { baseUrl: browserOrigin() }).pipe(
      Effect.provide(FetchHttpClient.layer)
    )
  );

  return client;
};

type UnauthorizedListener = () => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();

/**
 * Registers the reaction to a 401 from any request — the session guard reads
 * the session again and redirects to `/login` on "no session" (AC-SESSION-8).
 * `api/` imports no Solid or router API, so the guard registers it; the
 * returned function unsubscribes.
 */
export const onUnauthorized = (
  listener: UnauthorizedListener
): (() => void) => {
  unauthorizedListeners.add(listener);

  return () => {
    unauthorizedListeners.delete(listener);
  };
};

const notifyUnauthorized = (): void => {
  for (const listener of unauthorizedListeners) listener();
};

const httpTag = (error: HttpClientError.HttpClientError): ApiFailureTag =>
  error.reason._tag === 'TransportError' ? 'NetworkError' : 'RequestFailed';

/**
 * Maps the failure of a request to the failure model: a decoded contract error
 * keeps its tag and detail, an undecodable body is `InvalidResponse`, a
 * transport failure is `NetworkError` and any other answer `RequestFailed`.
 */
export const failureOf = (cause: Cause.Cause<unknown>): ApiFailure => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));

  if (Schema.isSchemaError(error)) return new ApiFailure('InvalidResponse');

  const tag = tagOf(error);

  if (tag !== undefined && isApiFailureTag(tag)) {
    return new ApiFailure(tag, detailOf(error));
  }

  return HttpClientError.isHttpClientError(error)
    ? new ApiFailure(httpTag(error))
    : new ApiFailure('RequestFailed');
};

/**
 * Runs one Effect in the browser client context. A failure rejects with
 * `ApiFailure` and nothing else, and a 401 notifies the `onUnauthorized`
 * listeners. This is the one Promise/Effect crossing of the client (AGENTS:
 * Writing Effect code, rule 5).
 */
const runEffect = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(
    effect.pipe(
      Effect.provideService(FetchHttpClient.RequestInit, requestInit),
      Effect.provideService(FetchHttpClient.Fetch, browserFetch)
    )
  );

  if (Exit.isSuccess(exit)) return exit.value;

  const failure = failureOf(exit.cause);

  if (failure.tag === 'Unauthorized') notifyUnauthorized();

  throw failure;
};

/** Runs one no-content derived-client call. */
export const request = <E>(
  use: (client: ReaderClient) => Effect.Effect<void, E>
): Promise<void> => runEffect(use(readerClient()));

const successCodec = <Endpoint extends EndpointWithSuccess>(
  endpoint: Endpoint
): Endpoint['~Success'] => {
  const [codec] = endpoint.success;

  // `HttpApiEndpoint` stores `Schema.toCodecJson(success)` in `endpoint.success`
  // typed as `ReadonlySet<Schema.Top>` while keeping the concrete codec type in
  // the phantom `~Success` property.
  return codec as unknown as Endpoint['~Success'];
};

/**
 * Runs one derived-client call and encodes its decoded response back to the
 * contract's wire (JSON) form, so Effect values never leave `api/`.
 */
export const requestJson = <Endpoint extends EndpointWithSuccess, E>(
  endpoint: Endpoint,
  use: (client: ReaderClient) => Effect.Effect<Endpoint['~Success']['Type'], E>
): Promise<EncodedSuccess<Endpoint>> => {
  const encode = Schema.encodeEffect(successCodec(endpoint));

  // `Schema.toCodecJson` widens `Encoded` to `Schema.Json`; `EncodedSuccess`
  // restores the struct shape of `endpoint['~Success']['schema']['Encoded']`.
  return runEffect(
    use(readerClient()).pipe(Effect.flatMap((value) => encode(value)))
  ) as Promise<EncodedSuccess<Endpoint>>;
};

/**
 * Ids and cursors are branded `@reader/business` values in the contract and plain
 * strings in the web (a route parameter, a stored cursor), which may not import
 * that package (reader-engineering: Packages). The brand is erased at runtime, so
 * this changes nothing and is the one place the two meet.
 */
export const contractId = (value: string): never => value as never;

/** One page of a cursor-paged list (CM-PAGE). */
export type ListPage<Item> = {
  readonly items: ReadonlyArray<Item>;
  readonly cursor: string | null;
};

/** What a paged list needs: `limit`, the unread filter and the cursor (CM-PAGE). */
export type ListQuery = {
  readonly limit: number;
  readonly unread: boolean;
  readonly cursor?: string | undefined;
};

/** A `ListQuery` as the contract's query object, without an absent cursor. */
export const listQuery = (query: ListQuery) => ({
  limit: query.limit,
  unread: query.unread,
  ...(query.cursor === undefined ? {} : { cursor: contractId(query.cursor) }),
});
