import { WebpageFetcherError } from '@reader/business';
import { Effect } from 'effect';
import type { ConnectionTransport } from 'puppeteer-core';
import WebSocket, { type RawData } from 'ws';

const failure = (message: string): WebpageFetcherError =>
  new WebpageFetcherError({ message });

/** A CDP message is a `Buffer` or an `ArrayBuffer`; the array case is a copy. */
const toText = (data: RawData): string =>
  Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : Buffer.from(new Uint8Array(data as ArrayBuffer)).toString('utf8');

/**
 * Puppeteer's transport callbacks may throw synchronously or return a Promise
 * that rejects (for example when a peer sends malformed JSON). Catching both
 * here keeps a bad frame inside the fetch's error channel instead of crashing
 * the process with an unhandled rejection.
 */
const closeTransport = async (
  socket: WebSocket,
  transport: ConnectionTransport
): Promise<void> => {
  if (socket.readyState !== WebSocket.CLOSED) {
    socket.terminate();
  }

  try {
    await (transport.onclose?.() as unknown);
  } catch {
    // A transport callback failure must not escape onto the process.
  }
};

const deliverMessage = async (
  transport: ConnectionTransport,
  closeOnce: () => Promise<void>,
  data: RawData
): Promise<void> => {
  try {
    await (transport.onmessage?.(toText(data)) as unknown);
  } catch {
    await closeOnce();
  }
};

/** The transport puppeteer speaks CDP over, backed by this socket. */
const transportFor = (socket: WebSocket): ConnectionTransport => {
  const transport: ConnectionTransport = {
    send: (message) => socket.send(message),
    close: () => {
      if (socket.readyState !== WebSocket.CLOSED) socket.close();
    },
  };
  let closed = false;
  const closeOnce = (): Promise<void> => {
    if (closed) return Promise.resolve();

    closed = true;

    return closeTransport(socket, transport);
  };

  socket.on('message', (data) => {
    if (!closed) void deliverMessage(transport, closeOnce, data);
  });
  socket.on('close', () => {
    void closeOnce();
  });
  socket.on('error', () => {
    void closeOnce();
  });

  return transport;
};

/** Opens the socket, or rejects as soon as the connection fails or is aborted. */
const openTransport = (
  url: string,
  signal: AbortSignal
): Promise<ConnectionTransport> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      allowSynchronousEvents: false,
      perMessageDeflate: false,
    });
    let settled = false;
    const fail = (cause: unknown) => {
      if (settled) return;

      settled = true;
      signal.removeEventListener('abort', abort);
      socket.terminate();
      reject(cause);
    };
    const abort = () => fail(signal.reason);

    socket.once('open', () => {
      if (settled) return;

      settled = true;
      signal.removeEventListener('abort', abort);
      const transport = transportFor(socket);
      socket.off('error', fail);
      resolve(transport);
    });
    socket.on('error', fail);
    signal.addEventListener('abort', abort, { once: true });

    if (signal.aborted) abort();
  });

const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

const WEBSOCKET_PROTOCOL: Record<string, string> = {
  'http:': 'ws:',
  'https:': 'wss:',
};

const DISCOVERY_PROTOCOL: Record<string, string> = {
  'ws:': 'http:',
  'wss:': 'https:',
};

const isSocketProtocol = (url: URL): boolean =>
  url.protocol === 'ws:' || url.protocol === 'wss:';

/** A discovery answer may be relative to the discovery URL it came from. */
const resolveSocketUrl = (value: string, discovery: URL): URL => {
  const url = new URL(value, discovery.href);

  if (!URL_SCHEME.test(value)) {
    url.protocol = WEBSOCKET_PROTOCOL[discovery.protocol] ?? url.protocol;
  }

  return url;
};

/** `/json/version` answers where the browser's CDP socket lives. */
const readDebuggerUrl = (payload: unknown, discovery: URL): string => {
  const value: unknown =
    typeof payload === 'object' && payload !== null
      ? Reflect.get(payload, 'webSocketDebuggerUrl')
      : undefined;

  if (typeof value !== 'string') {
    throw new Error('The browser discovery answer has no WebSocket URL');
  }

  const socket = resolveSocketUrl(value, discovery);

  if (!isSocketProtocol(socket)) {
    throw new Error('The browser discovery answer is no WebSocket URL');
  }

  // The answer is issued for the discovery URL's credentials.
  if (!socket.username && !socket.password) {
    socket.username = discovery.username;
    socket.password = discovery.password;
  }

  return socket.href;
};

const decodeCredential = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const basicAuthorization = (url: URL): string | undefined => {
  if (!url.username && !url.password) {
    return undefined;
  }

  const credentials = `${decodeCredential(url.username)}:${decodeCredential(url.password)}`;

  return `Basic ${Buffer.from(credentials).toString('base64')}`;
};

const versionUrl = (endpoint: URL): URL => {
  const url = new URL(endpoint.href);
  url.protocol = DISCOVERY_PROTOCOL[url.protocol] ?? url.protocol;
  url.pathname = `${url.pathname.replace(/\/?$/, '')}/json/version`;

  return url;
};

const requestVersion = async (
  endpoint: URL,
  signal: AbortSignal
): Promise<string> => {
  const discovery = versionUrl(endpoint);
  const authorization = basicAuthorization(discovery);
  // `fetch` refuses a request URL that carries credentials (CM-URL-4).
  const request = new URL(discovery.href);
  request.username = '';
  request.password = '';

  const response = await fetch(request, {
    method: 'GET',
    headers: authorization ? { authorization } : {},
    signal,
  });

  if (!response.ok) {
    throw new Error(`The browser discovery answered HTTP ${response.status}`);
  }

  return readDebuggerUrl(await response.json(), discovery);
};

/** An endpoint that already names the debugger socket is used as it is. */
const socketTarget = (endpoint: URL): string | undefined =>
  isSocketProtocol(endpoint) &&
  (endpoint.pathname !== '/' || Boolean(endpoint.search))
    ? endpoint.href
    : undefined;

const connect = (
  url: string
): Effect.Effect<ConnectionTransport, WebpageFetcherError> =>
  Effect.tryPromise({
    try: (signal) => openTransport(url, signal),
    catch: () => failure('Browser connection failed'),
  });

const discover = (endpoint: URL): Effect.Effect<string, WebpageFetcherError> =>
  Effect.tryPromise({
    try: (signal) => requestVersion(endpoint, signal),
    catch: () => failure('Browser discovery failed'),
  });

/**
 * Connects to the browser service once per fetch. A `ws:` or `wss:` endpoint
 * with a path is the debugger socket itself; any other endpoint is asked for
 * its debugger socket through `/json/version`. Messages never name the
 * endpoint, which is a secret (SET-VAL-4).
 */
export const connectEndpoint = (
  endpoint: URL
): Effect.Effect<ConnectionTransport, WebpageFetcherError> =>
  Effect.gen(function* () {
    const target = socketTarget(endpoint);

    return yield* connect(target ?? (yield* discover(endpoint)));
  });
