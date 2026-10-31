import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { Agent, fetch as undiciFetch } from '@effect/platform-node/Undici';
import { Data, Effect, Layer, type Scope, Stream } from 'effect';
import {
  FetchHttpClient,
  type Headers,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from 'effect/http';

export class FetchFailure extends Data.TaggedError('FetchFailure')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type PublicTextRequest = {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly maxBytes: number;
  readonly maxRedirects: number;
  readonly redirect?: globalThis.RequestRedirect;
};

export type PublicTextResponse = {
  readonly body: string;
  readonly headers: Headers.Headers;
  readonly ok: boolean;
  readonly status: number;
  readonly url: string;
};

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const isPublicIPv4 = (address: string): boolean => {
  const parts = address.split('.').map(Number);

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b] = parts;

  return (
    a !== undefined &&
    b !== undefined &&
    a > 0 &&
    a < 224 &&
    ![10, 127].includes(a) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && [0, 168].includes(b)) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && [18, 19, 51].includes(b)) &&
    !(a === 203 && b === 0)
  );
};

export const parsePublicUrl = (address: string): URL => {
  const url = new URL(address);

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  ) {
    throw new Error('Unsupported address');
  }

  return url;
};

export const selectPublicAddress = (records: readonly string[]): string => {
  const [first] = records;

  if (!first || records.some((address) => !isPublicIPv4(address))) {
    throw new Error('Private address');
  }

  return first;
};

export const pinnedAddressLookup =
  (address: string) =>
  (
    _hostname: string,
    options: LookupOptions,
    callback: LookupCallback
  ): void => {
    if (options.all) {
      callback(null, [{ address, family: 4 }]);

      return;
    }

    callback(null, address, 4);
  };

const resolvePinnedAddress = (
  hostname: string
): Effect.Effect<string, FetchFailure> =>
  Effect.tryPromise({
    try: async () => {
      const records = await lookup(hostname, { all: true, family: 4 });

      return selectPublicAddress(records.map((record) => record.address));
    },
    catch: (cause) =>
      new FetchFailure({ message: 'Unresolvable address', cause }),
  });

const acquireDispatcher = (
  address: string
): Effect.Effect<Agent, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(
      () =>
        new Agent({
          connect: { family: 4, lookup: pinnedAddressLookup(address) },
        })
    ),
    (agent) => Effect.promise(() => agent.destroy())
  );

const readTextBody = (
  response: HttpClientResponse.HttpClientResponse,
  maxBytes: number
): Effect.Effect<string, FetchFailure> =>
  Stream.runFoldEffect(
    response.stream,
    () => ({ chunks: [] as Uint8Array[], size: 0 }),
    (state, chunk) => {
      const size = state.size + chunk.length;

      if (size > maxBytes) {
        return Effect.fail(new FetchFailure({ message: 'Response too large' }));
      }

      state.chunks.push(chunk);

      return Effect.succeed({ chunks: state.chunks, size });
    }
  ).pipe(
    Effect.map((state) => Buffer.concat(state.chunks).toString('utf8')),
    Effect.mapError((cause) =>
      cause instanceof FetchFailure
        ? cause
        : new FetchFailure({ message: 'Response read failed', cause })
    )
  );

const sendHop = (
  url: URL,
  request: PublicTextRequest
): Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  FetchFailure,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const address = yield* resolvePinnedAddress(url.hostname);
    const dispatcher = yield* acquireDispatcher(address);

    return yield* HttpClient.execute(
      HttpClientRequest.get(url, { headers: request.headers })
    ).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.RequestInit, {
        dispatcher,
        redirect: request.redirect ?? 'manual',
      } as globalThis.RequestInit),
      Effect.mapError(
        (cause) => new FetchFailure({ message: 'Request failed', cause })
      )
    );
  });

type Hop =
  | { readonly _tag: 'redirect'; readonly url: URL }
  | { readonly _tag: 'response'; readonly response: PublicTextResponse };

const redirectTarget = (
  response: HttpClientResponse.HttpClientResponse,
  current: URL,
  redirects: number,
  maxRedirects: number
): Effect.Effect<URL, FetchFailure> => {
  const { location } = response.headers;

  if (!location || redirects >= maxRedirects) {
    return Effect.fail(new FetchFailure({ message: 'Too many redirects' }));
  }

  return Effect.try({
    try: () => parsePublicUrl(new URL(location, current).href),
    catch: (cause) => new FetchFailure({ message: 'Invalid redirect', cause }),
  });
};

const readHop = (
  url: URL,
  request: PublicTextRequest,
  redirects: number
): Effect.Effect<Hop, FetchFailure> =>
  Effect.scoped(
    Effect.gen(function* () {
      const response = yield* sendHop(url, request);

      if (REDIRECT_STATUSES.has(response.status)) {
        return {
          _tag: 'redirect',
          url: yield* redirectTarget(
            response,
            url,
            redirects,
            request.maxRedirects
          ),
        };
      }

      return {
        _tag: 'response',
        response: {
          body: yield* readTextBody(response, request.maxBytes),
          headers: response.headers,
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          url: url.href,
        },
      };
    })
  );

const follow = (
  url: URL,
  request: PublicTextRequest,
  redirects: number
): Effect.Effect<PublicTextResponse, FetchFailure> =>
  Effect.flatMap(readHop(url, request, redirects), (hop) =>
    hop._tag === 'redirect'
      ? follow(hop.url, request, redirects + 1)
      : Effect.succeed(hop.response)
  );

const parsePublicTarget = (address: string): Effect.Effect<URL, FetchFailure> =>
  Effect.try({
    try: () => parsePublicUrl(address),
    catch: (cause) =>
      new FetchFailure({ message: 'Unsupported address', cause }),
  });

export const validatePublicTarget = (
  address: string
): Effect.Effect<URL, FetchFailure> =>
  Effect.flatMap(parsePublicTarget(address), (url) =>
    Effect.map(resolvePinnedAddress(url.hostname), () => url)
  );

export const fetchPublicText = (
  request: PublicTextRequest
): Effect.Effect<PublicTextResponse, FetchFailure> =>
  Effect.flatMap(parsePublicTarget(request.url), (url) =>
    follow(url, request, 0)
  );

export const HttpFetchLive = Layer.succeed(
  FetchHttpClient.Fetch,
  undiciFetch as unknown as typeof globalThis.fetch
);
