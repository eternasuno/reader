import { EventEmitter } from 'node:events';
import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { beforeEach, vi } from 'vitest';
import type { ClientOptions } from 'ws';
import { fetchBrowser } from '../src/browser';

type Listener = (...args: Array<unknown>) => void;

type SocketStub = {
  readonly url: string;
  readyState: number;
  closeCalls: number;
  terminateCalls: number;
  readonly close: () => void;
  readonly terminate: () => void;
};

const { connectMock, fetchMock, sockets, realSockets } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  fetchMock: vi.fn(),
  sockets: [] as Array<SocketStub>,
  realSockets: { value: false },
}));

const createFakeSocket = (url: string): SocketStub => {
  const emitter = new EventEmitter();
  const finish = (key: 'closeCalls' | 'terminateCalls') => {
    socket[key] += 1;
    socket.readyState = 3;
    emitter.emit('close');
  };
  const socket: SocketStub = {
    url,
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
    emit: (event: string, ...args: Array<unknown>) =>
      emitter.emit(event, ...args),
  });
  sockets.push(socket);
  queueMicrotask(() => {
    socket.readyState = 1;
    emitter.emit('open');
  });

  return socket;
};

vi.mock('puppeteer-core', () => ({ connect: connectMock }));

vi.mock('ws', async () => {
  const actual = await vi.importActual<{
    default: new (
      url: string,
      protocols: Array<string>,
      options: ClientOptions
    ) => unknown;
  }>('ws');
  function Delegating(
    url: string,
    protocols: Array<string>,
    options: ClientOptions
  ) {
    return realSockets.value
      ? new actual.default(url, protocols, options)
      : createFakeSocket(url);
  }

  Object.assign(Delegating, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });

  return { default: Delegating };
});

const pageFixture = (html = '<html>ok</html>') => ({
  goto: vi.fn(async (_url: string, _options?: unknown) => undefined),
  waitForNetworkIdle: vi.fn(async (_options?: unknown) => {}),
  content: vi.fn(async () => html),
  close: vi.fn(async () => {}),
});

const browserFixture = (html?: string) => {
  const page = pageFixture(html);
  const browser = {
    newPage: vi.fn(async () => page),
    disconnect: vi.fn(async () => {}),
  };

  return { browser, page };
};

type Fixture = ReturnType<typeof browserFixture>;

const article = 'https://example.com/article';

const endpoint = 'http://127.0.0.1:9222';

const websocketUrl = 'ws://127.0.0.1:9222/devtools/browser/test';

const discoveryResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status });

const expectTeardown = ({ browser, page }: Fixture): void => {
  expect(page.close).toHaveBeenCalled();
  expect(browser.disconnect).toHaveBeenCalled();

  for (const socket of sockets) {
    expect(socket.readyState).toBe(3);
    expect(socket.closeCalls + socket.terminateCalls).toBeGreaterThan(0);
  }
};

beforeEach(() => {
  connectMock.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    discoveryResponse({ webSocketDebuggerUrl: websocketUrl })
  );
  vi.stubGlobal('fetch', fetchMock);
  sockets.length = 0;
  realSockets.value = false;
});

const actualPuppeteer =
  await vi.importActual<typeof import('puppeteer-core')>('puppeteer-core');

it.effect('discovers the debugger socket and returns the page html', () =>
  Effect.gen(function* () {
    const fixture = browserFixture();
    connectMock.mockResolvedValue(fixture.browser);

    expect(yield* fetchBrowser(article, endpoint)).toBe('<html>ok</html>');

    const [target, init] = fetchMock.mock.calls[0] ?? [];

    expect(String(target)).toBe('http://127.0.0.1:9222/json/version');
    expect(init).toMatchObject({ method: 'GET' });
    expect(sockets[0]?.url).toBe(websocketUrl);
    expect(connectMock).toHaveBeenCalledWith({
      transport: expect.anything(),
    });
    expect(fixture.page.goto).toHaveBeenCalledWith(article, {
      waitUntil: 'domcontentloaded',
    });
    expect(fixture.page.waitForNetworkIdle).toHaveBeenCalled();
    expectTeardown(fixture);
  })
);

it.effect('sends basic auth credentials to discovery and the socket', () =>
  Effect.gen(function* () {
    const fixture = browserFixture();
    connectMock.mockResolvedValue(fixture.browser);

    yield* fetchBrowser(article, 'http://user:secret@127.0.0.1:9222');

    const [target, init] = fetchMock.mock.calls[0] ?? [];

    expect(String(target)).toBe('http://127.0.0.1:9222/json/version');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('user:secret').toString('base64')}`
    );
    expect(sockets[0]?.url).toBe(
      'ws://user:secret@127.0.0.1:9222/devtools/browser/test'
    );
    expectTeardown(fixture);
  })
);

it.effect('uses a WebSocket endpoint without discovery', () =>
  Effect.gen(function* () {
    const fixture = browserFixture();
    connectMock.mockResolvedValue(fixture.browser);

    yield* fetchBrowser(article, websocketUrl);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sockets[0]?.url).toBe(websocketUrl);
    expectTeardown(fixture);
  })
);

it.effect('closes the page and connection after a failed extraction', () =>
  Effect.gen(function* () {
    const fixture = browserFixture();
    fixture.page.content.mockRejectedValue(new Error('Target closed'));
    connectMock.mockResolvedValue(fixture.browser);

    const failure = yield* Effect.flip(fetchBrowser(article, endpoint));

    expect(failure.message).toBe('Page content read failed');
    expectTeardown(fixture);
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
        obscuraEndpoint ?? ''
      );

      expect(html).toContain('class="quote"');
    }),
  { timeout: 60_000 }
);
