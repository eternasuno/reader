import {
  type BrowserEndpoint,
  WebpageFetcher,
  WebpageFetcherError,
} from '@reader/business';
import { Effect, Layer, Redacted } from 'effect';
import {
  type Browser,
  type ConnectionTransport,
  connect,
  type Page,
} from 'puppeteer-core';
import { connectEndpoint } from './cdp';

const failure = (message: string): WebpageFetcherError =>
  new WebpageFetcherError({ message });

/** One CDP call; the message names the step, never the endpoint (SET-VAL-4). */
const request = <A>(
  operation: () => Promise<A>,
  message: string
): Effect.Effect<A, WebpageFetcherError> =>
  Effect.tryPromise({ try: operation, catch: () => failure(message) });

/** Teardown never replaces the reason the fetch failed. */
const release = (
  operation: () => Promise<unknown>,
  message: string
): Effect.Effect<void> => request(operation, message).pipe(Effect.ignore);

const acquireBrowser = (transport: ConnectionTransport) =>
  Effect.acquireRelease(
    request(() => connect({ transport }), 'Browser connection failed'),
    (browser: Browser) =>
      release(() => browser.disconnect(), 'Browser disconnect failed'),
    { interruptible: true }
  );

const acquirePage = (browser: Browser) =>
  Effect.acquireRelease(
    request(() => browser.newPage(), 'Page creation failed'),
    (page: Page) => release(() => page.close(), 'Page close failed')
  );

const loadPage = (
  page: Page,
  url: string
): Effect.Effect<string, WebpageFetcherError> =>
  Effect.gen(function* () {
    yield* request(
      () => page.goto(url, { waitUntil: 'domcontentloaded' }),
      'Page navigation failed'
    );
    // A client-rendered page fills in its article after load.
    yield* request(
      () => page.waitForNetworkIdle(),
      'Page network idle wait failed'
    );

    return yield* request(() => page.content(), 'Page content read failed');
  });

/**
 * One fetch is one connection: the socket, the browser and the page are
 * acquired in a scope that closes them in reverse order (CM-FETCH-3).
 */
const fetchHtml = (
  endpoint: URL,
  url: string
): Effect.Effect<string, WebpageFetcherError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const transport = yield* Effect.acquireRelease(
        connectEndpoint(endpoint),
        (acquired) => Effect.sync(() => acquired.close()),
        { interruptible: true }
      );
      const browser = yield* acquireBrowser(transport);
      const page = yield* acquirePage(browser);

      return yield* loadPage(page, url);
    })
  );

/**
 * The browser-service fetcher of the owner's stored endpoint (SET-ACTIVE-1).
 * The endpoint is a secret and reaches nothing but the connection (SET-VAL-4).
 */
export const BrowserWebpageFetcherLive = (
  endpoint: BrowserEndpoint
): Layer.Layer<WebpageFetcher> =>
  Layer.succeed(WebpageFetcher, {
    fetch: (url: string) => fetchHtml(Redacted.value(endpoint), url),
  });
