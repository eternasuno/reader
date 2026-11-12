import { Effect } from 'effect';
import {
  type Browser,
  type ConnectionTransport,
  connect,
} from 'puppeteer-core';
import WebSocket from 'ws';
import { FetchFailure } from './failure';

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

const openSocket = (
  url: string,
  signal: AbortSignal
): Promise<ConnectionTransport> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const fail = (cause: unknown) => {
      socket.terminate();
      reject(cause);
    };
    const abort = () => fail(signal.reason);

    socket.once('open', () => {
      signal.removeEventListener('abort', abort);
      resolve(createTransport(socket));
    });
    socket.once('error', fail);
    signal.addEventListener('abort', abort, { once: true });

    if (signal.aborted) abort();
  });

const protocolRequest = <A>(
  operation: (signal: AbortSignal) => Promise<A>,
  message: string
): Effect.Effect<A, FetchFailure> =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new FetchFailure({ message, cause }),
  });

const isWebSocketTarget = (url: URL): boolean =>
  (url.protocol === 'ws:' || url.protocol === 'wss:') &&
  (url.pathname !== '/' || Boolean(url.search));

const discoveryUrl = (url: URL): URL => {
  const discovery = new URL(url.href);

  if (url.protocol === 'ws:') discovery.protocol = 'http:';
  if (url.protocol === 'wss:') discovery.protocol = 'https:';

  return discovery;
};

const endpointTarget = (
  endpoint: string
):
  | { readonly kind: 'websocket'; readonly url: string }
  | { readonly kind: 'discovery'; readonly url: string } => {
  const url = new URL(endpoint);

  return isWebSocketTarget(url)
    ? { kind: 'websocket', url: url.href }
    : { kind: 'discovery', url: discoveryUrl(url).href };
};

const WEBSOCKET_PROTOCOLS: Readonly<Record<string, string>> = {
  'http:': 'ws:',
  'https:': 'wss:',
};

const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

const resolveWebSocketUrl = (value: string, discovery: URL): URL => {
  const url = new URL(value, discovery.href);

  // A relative discovery answer inherits the discovery HTTP scheme.
  if (!URL_SCHEME.test(value)) {
    url.protocol = WEBSOCKET_PROTOCOLS[discovery.protocol] ?? url.protocol;
  }

  return url;
};

const readWebSocketUrl = (payload: unknown, discovery: URL): string => {
  const value: unknown =
    typeof payload === 'object' && payload !== null
      ? Reflect.get(payload, 'webSocketDebuggerUrl')
      : undefined;
  const endpoint =
    typeof value === 'string' ? resolveWebSocketUrl(value, discovery) : null;

  if (
    !endpoint ||
    (endpoint.protocol !== 'ws:' && endpoint.protocol !== 'wss:')
  ) {
    throw new Error('Invalid browser discovery WebSocket URL');
  }

  if (!endpoint.username && !endpoint.password) {
    endpoint.username = discovery.username;
    endpoint.password = discovery.password;
  }

  return endpoint.href;
};

const basicAuthorization = (url: URL): string | undefined =>
  url.username
    ? `Basic ${Buffer.from(`${url.username}:${url.password}`).toString('base64')}`
    : undefined;

const discoverWebSocketUrl = (
  endpoint: string
): Effect.Effect<string, FetchFailure> =>
  Effect.tryPromise({
    try: async (signal) => {
      const discovery = new URL(endpoint);
      discovery.pathname = `${discovery.pathname.replace(/\/?$/, '')}/json/version`;
      const authorization = basicAuthorization(discovery);
      // `fetch` refuses request URLs that embed credentials.
      const request = new URL(discovery.href);
      request.username = '';
      request.password = '';
      const response = await fetch(request, {
        method: 'GET',
        ...(authorization ? { headers: { authorization } } : {}),
        signal,
      });

      if (!response.ok) {
        throw new Error(`Browser discovery returned HTTP ${response.status}`);
      }

      return readWebSocketUrl(await response.json(), discovery);
    },
    catch: (cause) =>
      new FetchFailure({ message: 'Browser discovery failed', cause }),
  });

const acquireTransport = (endpoint: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const target = endpointTarget(endpoint);
      const url =
        target.kind === 'discovery'
          ? yield* discoverWebSocketUrl(target.url)
          : target.url;

      return yield* protocolRequest(
        (signal) => openSocket(url, signal),
        'Browser connection failed'
      );
    }),
    (transport) => Effect.sync(() => transport.close()),
    { interruptible: true }
  );

const acquireBrowser = (transport: ConnectionTransport) =>
  Effect.acquireRelease(
    protocolRequest(() => connect({ transport }), 'Browser connection failed'),
    (browser: Browser) =>
      protocolRequest(
        () => browser.disconnect(),
        'Browser disconnect failed'
      ).pipe(Effect.ignore),
    { interruptible: true }
  );

const acquirePage = (browser: Browser) =>
  Effect.acquireRelease(
    protocolRequest(() => browser.newPage(), 'Page creation failed'),
    (page) =>
      protocolRequest(() => page.close(), 'Page close failed').pipe(
        Effect.ignore
      )
  );

export const fetchBrowser = (
  url: string,
  endpoint: string
): Effect.Effect<string, FetchFailure> =>
  Effect.scoped(
    Effect.gen(function* () {
      const transport = yield* acquireTransport(endpoint);
      const browser = yield* acquireBrowser(transport);
      const page = yield* acquirePage(browser);
      yield* protocolRequest(
        () => page.goto(url, { waitUntil: 'domcontentloaded' }),
        'Page navigation failed'
      );
      yield* protocolRequest(
        () => page.waitForNetworkIdle(),
        'Page network idle wait failed'
      );

      return yield* protocolRequest(
        () => page.content(),
        'Page content read failed'
      );
    })
  );
