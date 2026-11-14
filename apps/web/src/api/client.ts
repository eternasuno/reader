import { LibraryApi } from '@reader/api';
import { Cause, Effect, Exit } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { toLibraryError } from './errors';

type FetchLike = typeof globalThis.fetch;

export type LibraryClientOptions = {
  readonly fetch?: FetchLike;
};

/** Used where the browser origin is missing, so a request URL stays absolute. */
const originlessHost = 'http://localhost';

const requestInit: RequestInit = {
  credentials: 'include',
  cache: 'no-store',
};

const browserOrigin = (): string =>
  (globalThis as { readonly location?: { readonly origin: string } }).location
    ?.origin ?? originlessHost;

const makeClient = () =>
  Effect.runSync(
    HttpApiClient.make(LibraryApi, { baseUrl: browserOrigin() }).pipe(
      Effect.provide(FetchHttpClient.layer)
    )
  );

type LibraryApiClient = ReturnType<typeof makeClient>;

/** Builds the derived client once and runs each call as a promise. */
export const makeRunner = (options: LibraryClientOptions) => {
  const client = makeClient();

  return async <A, E>(
    use: (api: LibraryApiClient) => Effect.Effect<A, E>
  ): Promise<A> => {
    const effect = use(client).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, requestInit)
    );
    const provided =
      options.fetch === undefined
        ? effect
        : Effect.provideService(effect, FetchHttpClient.Fetch, options.fetch);
    const exit = await Effect.runPromiseExit(provided);

    if (Exit.isSuccess(exit)) {
      return exit.value;
    }

    if (!Cause.hasFails(exit.cause)) {
      throw Cause.squash(exit.cause);
    }

    throw toLibraryError(exit.cause);
  };
};

export type Runner = ReturnType<typeof makeRunner>;
