import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer } from 'node:net';
import { setImmediate as nextTick } from 'node:timers/promises';
import { expect, it } from '@effect/vitest';
import {
  BrowserEndpoint,
  WebpageFetcher,
  WebpageFetcherError,
} from '@reader/business';
import { Effect, Schema } from 'effect';
import { type WebSocket, WebSocketServer } from 'ws';
import { BrowserWebpageFetcherLive } from '../src/browser';

const article = 'https://example.com/article';

const portOf = (address: ReturnType<WebSocketServer['address']>): number =>
  typeof address === 'object' && address !== null ? address.port : 0;

/** A port nothing listens on: opened and closed again before the fetch. */
const closedPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = portOf(server.address());
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

const startSocketServer = (
  onConnection: (socket: WebSocket, request: IncomingMessage) => void
): Promise<{ readonly server: WebSocketServer; readonly port: number }> =>
  new Promise((resolve, reject) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    server.on('connection', onConnection);
    server.once('error', reject);
    server.once('listening', () => {
      resolve({ server, port: portOf(server.address()) });
    });
  });

const closeSocketServer = (server: WebSocketServer): Promise<void> =>
  new Promise((resolve) => {
    for (const client of server.clients) {
      client.terminate();
    }
    server.close(() => resolve());
  });

const socketServerPort = (
  onConnection: (socket: WebSocket, request: IncomingMessage) => void
) =>
  Effect.acquireRelease(
    Effect.promise(() => startSocketServer(onConnection)),
    ({ server }) => Effect.promise(() => closeSocketServer(server))
  ).pipe(Effect.map(({ port }) => port));

const startHttpServer = (
  onRequest: (request: IncomingMessage, response: ServerResponse) => void
): Promise<{
  readonly server: ReturnType<typeof createHttpServer>;
  readonly port: number;
}> =>
  new Promise((resolve, reject) => {
    const server = createHttpServer(onRequest);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: portOf(server.address()) });
    });
  });

const closeHttpServer = (
  server: ReturnType<typeof createHttpServer>
): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
  });

const httpServerPort = (
  onRequest: (request: IncomingMessage, response: ServerResponse) => void
) =>
  Effect.acquireRelease(
    Effect.promise(() => startHttpServer(onRequest)),
    ({ server }) => Effect.promise(() => closeHttpServer(server))
  ).pipe(Effect.map(({ port }) => port));

const fetchPage = (endpoint: string) =>
  Effect.flatMap(WebpageFetcher, (fetcher) => fetcher.fetch(article)).pipe(
    Effect.provide(
      BrowserWebpageFetcherLive(Schema.decodeSync(BrowserEndpoint)(endpoint))
    )
  );

const fetchWithoutUnhandled = (endpoint: string) =>
  Effect.gen(function* () {
    const unhandled: Array<unknown> = [];
    let notifyUnhandled: (() => void) | undefined;
    const onUnhandled = (cause: unknown) => {
      unhandled.push(cause);
      notifyUnhandled?.();
    };
    const waitForUnhandled = Effect.callback<WebpageFetcherError>((resume) => {
      notifyUnhandled = () =>
        resume(
          Effect.succeed(
            new WebpageFetcherError({ message: 'Unhandled process error' })
          )
        );
    });

    process.on('unhandledRejection', onUnhandled);
    process.on('uncaughtException', onUnhandled);

    try {
      const failure = yield* Effect.raceFirst(
        Effect.flip(fetchPage(endpoint)),
        waitForUnhandled
      );
      yield* Effect.promise(() => nextTick());

      return { failure, unhandled };
    } finally {
      process.off('unhandledRejection', onUnhandled);
      process.off('uncaughtException', onUnhandled);
    }
  });

it.effect('CM-FETCH-4 reports an unreachable browser service', () =>
  Effect.gen(function* () {
    const port = yield* Effect.promise(closedPort);
    const failure = yield* Effect.flip(fetchPage(`http://127.0.0.1:${port}`));

    expect(failure._tag).toBe('WebpageFetcherError');
    expect(failure.message).toBe('Browser discovery failed');
    expect(failure.message).not.toContain(String(port));
    expect(failure.message).not.toContain('127.0.0.1');
  })
);

it.effect('CM-FETCH-4 reports an unreachable debugger socket', () =>
  Effect.gen(function* () {
    const port = yield* Effect.promise(closedPort);
    const failure = yield* Effect.flip(
      fetchPage(`ws://127.0.0.1:${port}/devtools/browser/reader`)
    );

    expect(failure._tag).toBe('WebpageFetcherError');
    expect(failure.message).toBe('Browser connection failed');
    expect(failure.message).not.toContain(String(port));
  })
);

it.effect('SET-VAL-4 keeps the endpoint credentials out of the message', () =>
  Effect.gen(function* () {
    const port = yield* Effect.promise(closedPort);
    const failure = yield* Effect.flip(
      fetchPage(`http://user:secret@127.0.0.1:${port}`)
    );

    expect(failure._tag).toBe('WebpageFetcherError');
    expect(failure.message).not.toContain('user');
    expect(failure.message).not.toContain('secret');
    expect(failure.message).not.toContain(String(port));
  })
);

it.effect(
  'CM-FETCH-4 catches malformed CDP frames without an unhandled rejection',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const replyPort = yield* socketServerPort((socket) => {
          socket.on('message', () => socket.send('{not-json'));
        });
        const replyResult = yield* fetchWithoutUnhandled(
          `ws://127.0.0.1:${replyPort}/devtools/browser/reader`
        );

        expect(replyResult.unhandled).toEqual([]);
        expect(replyResult.failure._tag).toBe('WebpageFetcherError');
        expect(replyResult.failure.message).toBe('Browser connection failed');
        expect(replyResult.failure.message).not.toContain(String(replyPort));

        const greetPort = yield* socketServerPort((socket) => {
          socket.send('{not-json');
        });
        const greetResult = yield* fetchWithoutUnhandled(
          `ws://127.0.0.1:${greetPort}/devtools/browser/reader`
        );

        expect(greetResult.unhandled).toEqual([]);
        expect(greetResult.failure._tag).toBe('WebpageFetcherError');
        expect(greetResult.failure.message).toBe('Browser connection failed');
        expect(greetResult.failure.message).not.toContain(String(greetPort));
      })
    )
);

it.effect(
  'SET-VAL-3 discovers the debugger socket for http and root ws endpoints',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connectedPaths: Array<string | undefined> = [];
        const wsPort = yield* socketServerPort((socket, request) => {
          connectedPaths.push(request.url);
          socket.close();
        });
        const discoveryRequests: Array<string | undefined> = [];
        const httpPort = yield* httpServerPort((request, response) => {
          discoveryRequests.push(request.url);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              webSocketDebuggerUrl: `ws://127.0.0.1:${wsPort}/devtools/browser/reader`,
            })
          );
        });

        const httpFailure = yield* Effect.flip(
          fetchPage(`http://127.0.0.1:${httpPort}`)
        );
        const wsFailure = yield* Effect.flip(
          fetchPage(`ws://127.0.0.1:${httpPort}`)
        );

        expect(discoveryRequests).toEqual(['/json/version', '/json/version']);
        expect(connectedPaths).toEqual([
          '/devtools/browser/reader',
          '/devtools/browser/reader',
        ]);
        expect(httpFailure.message).toBe('Browser connection failed');
        expect(wsFailure.message).toBe('Browser connection failed');
      })
    )
);

it.effect(
  'CM-URL-4 decodes percent-encoded credentials in the discovery request',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let authorization: string | undefined;
        const port = yield* httpServerPort((request, response) => {
          authorization = request.headers.authorization;
          response.writeHead(500);
          response.end();
        });

        const failure = yield* Effect.flip(
          fetchPage(`http://user:p%40ss@127.0.0.1:${port}`)
        );
        const decoded = authorization?.startsWith('Basic ')
          ? Buffer.from(
              authorization.slice('Basic '.length),
              'base64'
            ).toString('utf8')
          : undefined;

        expect(decoded).toBe('user:p@ss');
        expect(failure._tag).toBe('WebpageFetcherError');
        expect(failure.message).toBe('Browser discovery failed');
        expect(failure.message).not.toContain('p@ss');
        expect(failure.message).not.toContain('p%40ss');
      })
    )
);
