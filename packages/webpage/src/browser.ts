import { Effect, Redacted } from 'effect';
import {
  type Browser,
  type ConnectionTransport,
  connect,
  type HTTPRequest,
  type Page,
} from 'puppeteer-core';
import WebSocket from 'ws';
import { FetchFailure, validatePublicTarget } from './http';

const CONNECT_TIMEOUT = '15 seconds';
const NAVIGATION_TIMEOUT_MS = 20_000;
const NETWORK_IDLE_TIME_MS = 500;

const createTransport = (socket: WebSocket): ConnectionTransport => {
  const transport: ConnectionTransport = {
    send: (message) => socket.send(message),
    close: () => {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    },
  };

  socket.on('message', (data) =>
    transport.onmessage?.(
      Buffer.concat(
        Array.isArray(data) ? data : [Buffer.from(new Uint8Array(data))]
      ).toString('utf8')
    )
  );
  socket.on('close', () => transport.onclose?.());
  socket.on('error', () => {
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  });

  return transport;
};

const connectionTimeout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: CONNECT_TIMEOUT,
      orElse: () =>
        Effect.fail(
          new FetchFailure({ message: 'Browser connection timed out' })
        ),
    })
  );

const openSocket = (
  url: string,
  signal: AbortSignal
): Promise<ConnectionTransport> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url, [], {
      allowSynchronousEvents: false,
      followRedirects: true,
      handshakeTimeout: 10_000,
      perMessageDeflate: false,
    });
    const cleanup = () => signal.removeEventListener('abort', abort);
    const fail = (cause: unknown) => {
      cleanup();
      socket.terminate();
      reject(
        cause instanceof Error
          ? cause
          : new FetchFailure({ message: 'Browser socket failed', cause })
      );
    };
    const abort = () => fail(signal.reason);

    socket.once('open', () => {
      cleanup();
      resolve(createTransport(socket));
    });
    socket.once('error', fail);
    signal.addEventListener('abort', abort, { once: true });

    if (signal.aborted) {
      abort();
    }
  });

const endpointTarget = (endpoint: string) => {
  const url = new URL(endpoint);

  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    if (url.pathname !== '/' || url.search || url.hash) {
      return { kind: 'websocket', url: url.href };
    }

    const protocol = url.protocol === 'wss:' ? 'https:' : 'http:';

    return { kind: 'discovery', url: `${protocol}//${url.host}` };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported browser endpoint');
  }

  return { kind: 'discovery', url: url.href };
};

const readWebSocketUrl = (payload: unknown): string => {
  const value: unknown =
    typeof payload === 'object' && payload !== null
      ? Reflect.get(payload, 'webSocketDebuggerUrl')
      : undefined;
  const endpoint = typeof value === 'string' ? new URL(value) : null;

  if (
    !endpoint ||
    (endpoint.protocol !== 'ws:' && endpoint.protocol !== 'wss:')
  ) {
    throw new Error('Invalid browser discovery WebSocket URL');
  }

  return endpoint.href;
};

const discoverWebSocketUrl = (
  browserURL: string
): Effect.Effect<string, FetchFailure> =>
  Effect.tryPromise({
    try: async (signal) => {
      const url = new URL(browserURL);
      url.pathname = `${url.pathname.replace(/\/?$/, '')}/json/version`;
      url.hash = '';
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });

      if (!response.ok) {
        throw new Error(`Browser discovery returned HTTP ${response.status}`);
      }

      const payload: unknown = await response.json();

      return readWebSocketUrl(payload);
    },
    catch: (cause) =>
      new FetchFailure({ message: 'Browser discovery failed', cause }),
  });

const openTransport = (
  endpoint: Redacted.Redacted<string>
): Effect.Effect<ConnectionTransport, FetchFailure> =>
  Effect.gen(function* () {
    const target = yield* Effect.try({
      try: () => endpointTarget(Redacted.value(endpoint)),
      catch: (cause) =>
        new FetchFailure({ message: 'Invalid browser endpoint', cause }),
    });
    let url = target.url;

    if (target.kind === 'discovery') {
      url = yield* discoverWebSocketUrl(target.url);
    }

    return yield* connectionTimeout(
      Effect.tryPromise({
        try: (signal) => openSocket(url, signal),
        catch: (cause) =>
          new FetchFailure({ message: 'Browser connection failed', cause }),
      })
    );
  });

const acquireBrowser = (endpoint: Redacted.Redacted<string>) =>
  Effect.flatMap(
    Effect.acquireRelease(
      openTransport(endpoint),
      (transport) => Effect.sync(() => transport.close()),
      { interruptible: true }
    ),
    (transport) =>
      Effect.acquireRelease(
        connectionTimeout(
          Effect.tryPromise({
            try: () => connect({ transport, protocolTimeout: 15_000 }),
            catch: (cause) =>
              new FetchFailure({ message: 'Browser connection failed', cause }),
          })
        ),
        (browser: Browser) =>
          Effect.tryPromise({
            try: () => browser.disconnect(),
            catch: (cause) =>
              new FetchFailure({ message: 'Browser disconnect failed', cause }),
          }).pipe(Effect.ignore),
        { interruptible: true }
      )
  );

const protocolRequest = <A>(
  operation: () => Promise<A>,
  message: string
): Effect.Effect<A, FetchFailure> =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new FetchFailure({ message, cause }),
  });

const acquireContext = (browser: Browser) =>
  Effect.acquireRelease(
    protocolRequest(
      () => browser.createBrowserContext(),
      'Browser context creation failed'
    ),
    (context) =>
      protocolRequest(
        () => context.close(),
        'Browser context close failed'
      ).pipe(Effect.ignore)
  );

const MISSING_METHOD =
  /Unknown Network method|not implemented|isn't supported|wasn't found/i;

const isMissingBypassMethod = (cause: unknown): boolean =>
  cause instanceof Error &&
  cause.message.includes('Network.setBypassServiceWorker') &&
  MISSING_METHOD.test(cause.message);

const answerRequest = (request: HTTPRequest): Effect.Effect<void> =>
  validatePublicTarget(request.url()).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
    Effect.flatMap((allowed) =>
      protocolRequest(
        () => (allowed ? request.continue() : request.abort('blockedbyclient')),
        'Request handling failed'
      )
    ),
    Effect.ignore
  );

const acquireRequestGuard = (page: Page) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const listener = (request: HTTPRequest) => {
          Effect.runFork(answerRequest(request));
        };
        page.on('request', listener);

        try {
          await page.setRequestInterception(true);
          await page.setBypassServiceWorker(true);

          return { listener };
        } catch (cause) {
          page.off('request', listener);

          if (!isMissingBypassMethod(cause)) {
            throw cause;
          }

          await page.setRequestInterception(false);

          return { listener: null };
        }
      },
      catch: (cause) =>
        new FetchFailure({ message: 'Request interception failed', cause }),
    }),
    ({ listener }) =>
      Effect.sync(() => {
        if (listener) {
          page.off('request', listener);
        }
      })
  );

const navigate = (page: Page, target: URL): Effect.Effect<void, FetchFailure> =>
  Effect.gen(function* () {
    const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
    const response = yield* protocolRequest(
      () =>
        page.goto(target.href, {
          waitUntil: 'domcontentloaded',
          timeout: NAVIGATION_TIMEOUT_MS,
        }),
      'Page navigation failed'
    );
    const status = response?.status() ?? 0;

    if (status >= 400) {
      return yield* new FetchFailure({
        message: `Page returned HTTP ${status}`,
      });
    }

    yield* protocolRequest(
      () =>
        page.waitForNetworkIdle({
          idleTime: NETWORK_IDLE_TIME_MS,
          concurrency: 0,
          timeout: Math.max(NETWORK_IDLE_TIME_MS, deadline - Date.now()),
        }),
      'Page network idle wait failed'
    );
  });

const readHtml = (page: Page): Effect.Effect<string, FetchFailure> =>
  protocolRequest(() => page.content(), 'Page content read failed').pipe(
    Effect.filterOrFail(
      (html) => Buffer.byteLength(html, 'utf8') <= 5 * 1024 * 1024,
      () => new FetchFailure({ message: 'Page too large' })
    )
  );

const extractPage = (
  target: URL,
  endpoint: Redacted.Redacted<string>
): Effect.Effect<string, FetchFailure> =>
  Effect.scoped(
    Effect.gen(function* () {
      const browser = yield* acquireBrowser(endpoint);
      const context = yield* acquireContext(browser);
      const page = yield* protocolRequest(
        () => context.newPage(),
        'Page creation failed'
      );
      yield* acquireRequestGuard(page);
      yield* navigate(page, target);

      return yield* readHtml(page);
    })
  );

export const fetchBrowser = (
  url: string,
  endpoint: Redacted.Redacted<string>
): Effect.Effect<string, FetchFailure> =>
  Effect.flatMap(validatePublicTarget(url), (target) =>
    extractPage(target, endpoint)
  );
