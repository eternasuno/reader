import { EventEmitter } from 'node:events';
import { expect, it } from '@effect/vitest';
import { Effect, Fiber, Redacted } from 'effect';
import { beforeEach, vi } from 'vitest';
import type { ClientOptions } from 'ws';
import { fetchBrowser } from '../src/browser';

type SocketMode = 'open' | 'hang' | 'error';
type Listener = (...args: unknown[]) => void;

type SocketStub = {
  readonly url: string;
  readonly options: ClientOptions;
  readyState: number;
  closeCalls: number;
  terminateCalls: number;
  readonly close: () => void;
  readonly terminate: () => void;
};

const { connectMock, fetchMock, sockets, socketMode, realSockets } = vi.hoisted(
  () => ({
    connectMock: vi.fn(),
    fetchMock: vi.fn(),
    sockets: [] as SocketStub[],
    socketMode: { value: 'open' as SocketMode },
    realSockets: { value: false },
  })
);

const createFakeSocket = (url: string, options: ClientOptions): SocketStub => {
  const emitter = new EventEmitter();
  const finish = (key: 'closeCalls' | 'terminateCalls') => {
    socket[key] += 1;
    socket.readyState = 3;
    emitter.emit('close');
  };
  const socket: SocketStub = {
    url,
    options,
    readyState: 0,
    closeCalls: 0,
    terminateCalls: 0,
    close: () => finish('closeCalls'),
    terminate: () => finish('terminateCalls'),
  };

  Object.assign(socket, {
    on: (event: string, listener: Listener) => emitter.on(event, listener),
    once: (event: string, listener: Listener) => emitter.once(event, listener),
    send: () => {},
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
  });
  sockets.push(socket);
  queueMicrotask(() => {
    if (socketMode.value === 'open') {
      socket.readyState = 1;
      emitter.emit('open');
    } else if (socketMode.value === 'error') {
      emitter.emit('error', new Error('Socket refused'));
    }
  });

  return socket;
};

vi.mock('puppeteer-core', () => ({ connect: connectMock }));

vi.mock('ws', async () => {
  const actual = await vi.importActual<{
    default: new (
      url: string,
      protocols: string[],
      options: ClientOptions
    ) => unknown;
  }>('ws');
  function Delegating(
    url: string,
    protocols: string[],
    options: ClientOptions
  ) {
    return realSockets.value
      ? new actual.default(url, protocols, options)
      : createFakeSocket(url, options);
  }

  Object.assign(Delegating, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });

  return { default: Delegating };
});

type RequestFixture = {
  readonly url: () => string;
  readonly continue: ReturnType<typeof vi.fn>;
  readonly abort: ReturnType<typeof vi.fn>;
};

type RequestListener = (request: RequestFixture) => void;

const request = (url: string): RequestFixture => ({
  url: () => url,
  continue: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
});

const pageFixture = (html = '<html>ok</html>', status = 200) => {
  const listeners = new Set<RequestListener>();

  return {
    listeners,
    setRequestInterception: vi.fn(async () => {}),
    setBypassServiceWorker: vi.fn(async () => {}),
    on: vi.fn((_event: string, listener: RequestListener) =>
      listeners.add(listener)
    ),
    off: vi.fn((_event: string, listener: RequestListener) =>
      listeners.delete(listener)
    ),
    goto: vi.fn(async () => ({ status: () => status })),
    waitForNetworkIdle: vi.fn(async (..._args: unknown[]) => {}),
    content: vi.fn(async () => html),
    emit: (request: RequestFixture) => {
      for (const listener of listeners) listener(request);
    },
  };
};

const browserFixture = (html?: string, status?: number) => {
  const page = pageFixture(html, status);
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  const browser = {
    createBrowserContext: vi.fn(async () => context),
    disconnect: vi.fn(async () => {}),
  };

  return { browser, context, page };
};

type Fixture = ReturnType<typeof browserFixture>;

const endpoint = Redacted.make('ws://127.0.0.1:9222');
const websocketUrl = 'ws://127.0.0.1:9222/devtools/browser/test';

const discoveryResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status });

const expectClosedSockets = (): void => {
  for (const socket of sockets) {
    expect(socket.readyState).toBe(3);
    expect(socket.closeCalls + socket.terminateCalls).toBeGreaterThan(0);
  }
};

const expectTeardown = ({ browser, context, page }: Fixture): void => {
  expect(context.close).toHaveBeenCalled();
  expect(browser.disconnect).toHaveBeenCalled();
  expect(page.listeners.size).toBe(0);
  expectClosedSockets();
};

const failFetch = (
  url = 'http://8.8.8.8/article',
  browserEndpoint = endpoint
) => Effect.flip(fetchBrowser(url, browserEndpoint));

beforeEach(() => {
  connectMock.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    discoveryResponse({ webSocketDebuggerUrl: websocketUrl })
  );
  vi.stubGlobal('fetch', fetchMock);
  sockets.length = 0;
  socketMode.value = 'open';
  realSockets.value = false;
});

const actualPuppeteer =
  await vi.importActual<typeof import('puppeteer-core')>('puppeteer-core');

it.effect('extracts through an isolated context and disconnects', () =>
  Effect.gen(function* () {
    const fixture = browserFixture();
    connectMock.mockResolvedValue(fixture.browser);
    expect(yield* fetchBrowser('http://8.8.8.8/article', endpoint)).toBe(
      '<html>ok</html>'
    );
    const [target, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(target)).toBe('http://127.0.0.1:9222/json/version');
    expect(init).toMatchObject({ method: 'GET' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(sockets[0]).toMatchObject({
      url: websocketUrl,
      options: { handshakeTimeout: 10_000, perMessageDeflate: false },
    });
    expect(connectMock).toHaveBeenCalledWith({
      transport: expect.anything(),
      protocolTimeout: 15_000,
    });
    expect(fixture.page.waitForNetworkIdle.mock.calls[0]?.[0]).toMatchObject({
      idleTime: 500,
      concurrency: 0,
    });
    expectTeardown(fixture);
  })
);

it.effect('rejects invalid targets before connecting', () =>
  Effect.gen(function* () {
    for (const url of [
      'http://127.0.0.1/article',
      'ftp://8.8.8.8/article',
      'http://user:pass@8.8.8.8/article',
    ]) {
      expect((yield* failFetch(url))._tag).toBe('FetchFailure');
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  })
);

it.effect('blocks private and unsupported subresource requests', () =>
  Effect.gen(function* () {
    const { browser, page } = browserFixture();
    const allowed = request('http://1.1.1.1/style.css');
    const blocked = request('http://127.0.0.1/secret');
    const unsupported = request('data:text/html,private');
    page.goto.mockImplementation(async () => {
      for (const item of [allowed, blocked, unsupported]) {
        page.emit(item);
      }

      return { status: () => 200 };
    });
    connectMock.mockResolvedValue(browser);
    yield* fetchBrowser('http://8.8.8.8/article', endpoint);
    yield* Effect.promise(() =>
      vi.waitFor(() => {
        expect(allowed.continue).toHaveBeenCalled();
        expect(blocked.abort).toHaveBeenCalledWith('blockedbyclient');
        expect(unsupported.abort).toHaveBeenCalledWith('blockedbyclient');
      })
    );
  })
);

it.effect('cleans up after extraction failures', () =>
  Effect.gen(function* () {
    const fixture = browserFixture();
    fixture.page.content.mockResolvedValue('a'.repeat(5 * 1024 * 1024 + 1));
    connectMock.mockResolvedValue(fixture.browser);
    expect((yield* failFetch()).message).toBe('Page too large');
    expectTeardown(fixture);
  })
);

it.effect('only falls back for the missing bypass method', () =>
  Effect.gen(function* () {
    const fallback = browserFixture();
    fallback.page.setBypassServiceWorker.mockRejectedValue(
      new Error('Network.setBypassServiceWorker: Unknown Network method')
    );
    connectMock.mockResolvedValue(fallback.browser);
    yield* fetchBrowser('http://8.8.8.8/article', endpoint);
    expect(fallback.page.setRequestInterception.mock.calls).toEqual([
      [true],
      [false],
    ]);
    expectTeardown(fallback);
    for (const message of [
      'Network.enable: Unknown Fetch method',
      'Page.setBypassServiceWorker: Unknown Page method',
    ]) {
      const fixture = browserFixture();
      fixture.page.setBypassServiceWorker.mockRejectedValue(new Error(message));
      connectMock.mockResolvedValue(fixture.browser);
      expect((yield* failFetch()).message).toBe('Request interception failed');
      expect(fixture.page.setRequestInterception.mock.calls).toEqual([[true]]);
      expectTeardown(fixture);
    }
  })
);

it.effect('closes the transport when acquisition fails', () =>
  Effect.gen(function* () {
    connectMock.mockRejectedValue(new Error('initialization failed'));
    expect((yield* failFetch()).message).toBe('Browser connection failed');
    expectClosedSockets();
    connectMock.mockReset();
    socketMode.value = 'error';
    expect((yield* failFetch()).message).toBe('Browser connection failed');
    expectClosedSockets();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(discoveryResponse({}));
    expect((yield* failFetch()).message).toBe('Browser discovery failed');
    expect(sockets).toHaveLength(2);
  })
);

it.effect('closes the transport on interruption', () =>
  Effect.gen(function* () {
    socketMode.value = 'hang';
    const fiber = yield* fetchBrowser('http://8.8.8.8/article', endpoint).pipe(
      Effect.forkChild
    );
    yield* Effect.promise(() =>
      vi.waitFor(() => expect(sockets).toHaveLength(1))
    );
    yield* Fiber.interrupt(fiber);
    expect(connectMock).not.toHaveBeenCalled();
    expectClosedSockets();
  })
);

const { OBSCURA_WS_ENDPOINT: obscuraEndpoint } = process.env;

it.effect.runIf(obscuraEndpoint)(
  'renders JavaScript content against a real obscura browser',
  () =>
    Effect.gen(function* () {
      vi.unstubAllGlobals();
      realSockets.value = true;
      connectMock.mockImplementation(actualPuppeteer.connect);
      const html = yield* fetchBrowser(
        'https://quotes.toscrape.com/js/',
        Redacted.make(obscuraEndpoint ?? '')
      );
      expect(html).toContain('class="quote"');
    }),
  { timeout: 60_000 }
);
