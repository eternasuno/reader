import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem';
import { layer as nodeHttpPlatformLayer } from '@effect/platform-node/NodeHttpPlatform';
import { layer as nodePathLayer } from '@effect/platform-node/NodePath';
import {
  ArticleContent,
  ArticleExtractor,
  ArticleTitle,
  DocumentSanitizer,
  type FeedId,
  FeedParser,
  FeedTitle,
  type HtmlDocument,
  HtmlDocument as HtmlDocumentSchema,
  HtmlParser,
  HtmlParserError,
  type ParsedFeed,
  SettingRepository,
  SettingRepositoryError,
} from '@reader/business';
import { alice } from '@reader/business/testing';
import { readerStoreDatabaseLayer } from '@reader/sqlite/testing';
import { Cause, Effect, Exit, Layer, Option, type Scope } from 'effect';
import {
  Etag,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpServerRespondable as Respondable,
} from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import {
  Authentication,
  OriginCheck,
  ReaderApi,
  Session,
} from '../../../src/contract';
import { ReaderHandlersLive } from '../../../src/server/http';
import type { KindleSend } from '../../../src/server/kindle/sender';
import { KindleSender } from '../../../src/server/kindle/sender';
import { FeedRefreshQueue } from '../../../src/server/refresh/queue';

/** What an endpoint test may change about the environment. */
export type TestOptions = {
  /** Records every enqueued refresh (FD-SCHED-7). */
  readonly calls?: Array<FeedId>;
  /** The body of every fetched page; the Jina fetcher reads this (CM-FETCH). */
  readonly pageHtml?: string;
  /** A non-2xx fetch fails `WebpageFetcherError` (CM-FETCH-4). */
  readonly fetchStatus?: number;
  /** The page cannot be parsed, which the endpoint answers as a 422. */
  readonly parseFails?: boolean;
  /** Nothing is extracted: `ArticleEmptyContent` (CM-ART-5). */
  readonly extractEmpty?: boolean;
  /** Reading the owner's setting fails `SettingRepositoryError` (CM-FETCH-4). */
  readonly settingFails?: boolean;
  /** What a send-now request does; nothing unread by default (KD-SEND-8). */
  readonly kindle?: KindleSend;
};

const document = (): HtmlDocument =>
  HtmlDocumentSchema.make('<html><body><p>Body</p></body></html>');

const feed: ParsedFeed = {
  title: FeedTitle.make('Preview'),
  description: Option.none(),
  entries: [],
};

/**
 * The content ports answer without parsing anything: the HTTP layer tests the
 * request and response, not the adapters (reader-engineering: Testing).
 */
const article = (empty: boolean) => ({
  title: ArticleTitle.make('Article'),
  description: Option.none(),
  content: empty
    ? Option.none()
    : Option.some(ArticleContent.make('<p>Body</p>')),
  publishedAt: Option.none(),
});

const contentLayer = ({
  parseFails = false,
  extractEmpty = false,
}: TestOptions) =>
  Layer.mergeAll(
    Layer.succeed(HtmlParser, {
      parse: () =>
        parseFails
          ? Effect.fail(new HtmlParserError({ message: 'parse failed' }))
          : Effect.succeed(document()),
    }),
    Layer.succeed(ArticleExtractor, {
      extract: () => Effect.succeed(article(extractEmpty)),
    }),
    Layer.succeed(FeedParser, { parse: () => Effect.succeed(feed) }),
    Layer.succeed(DocumentSanitizer, {
      sanitize: () => Effect.succeedNone,
    })
  );

/** Every fetch answers with the given body and status (CM-FETCH-3). */
const httpClientLayer = ({
  pageHtml = '<html></html>',
  fetchStatus = 200,
}: TestOptions) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(pageHtml, { status: fetchStatus })
        )
      )
    )
  );

const queueLayer = (calls: Array<FeedId>) =>
  Layer.succeed(FeedRefreshQueue, {
    enqueue: (_owner, feedId) =>
      Effect.sync(() => {
        calls.push(feedId);
      }),
  });

/** The send-now service, stubbed: the HTTP layer tests the request, not a send (KD-SEND). */
const kindleLayer = ({ kindle }: TestOptions) =>
  Layer.succeed(KindleSender, {
    send: kindle ?? (() => Effect.succeed({ count: 0 })),
  });

/**
 * A request that carries no session and no origin passes both checks; the
 * real middleware is tested with the server (reader-engineering: Testing).
 */
const middlewareLayer = Layer.mergeAll(
  Layer.succeed(Authentication, (httpEffect) =>
    Effect.provideService(httpEffect, Session, { ownerId: alice })
  ),
  Layer.succeed(OriginCheck, (httpEffect) => httpEffect)
);

const platformLayer = Layer.mergeAll(
  nodePathLayer,
  Etag.layerWeak,
  nodeHttpPlatformLayer
).pipe(Layer.provideMerge(nodeFileSystemLayer));

const storeLayer = ({ settingFails = false }: TestOptions) =>
  settingFails
    ? Layer.provideMerge(
        Layer.mock(SettingRepository, {
          get: () =>
            Effect.fail(new SettingRepositoryError({ message: 'settings' })),
        }),
        readerStoreDatabaseLayer
      )
    : readerStoreDatabaseLayer;

/**
 * The handlers over a fresh in-memory database, with stubs for everything
 * outside the HTTP layer; the repositories stay in the environment so a test
 * can seed and inspect rows.
 */
const environmentLayer = (options: TestOptions) =>
  Layer.mergeAll(
    storeLayer(options),
    middlewareLayer,
    contentLayer(options),
    httpClientLayer(options),
    queueLayer(options.calls ?? []),
    kindleLayer(options),
    platformLayer
  );

type Environment =
  | Layer.Success<typeof ReaderHandlersLive>
  | Layer.Success<ReturnType<typeof environmentLayer>>;

/**
 * The handlers with every dependency, over a fresh in-memory database. The
 * cast drops the `HttpRouter` request markers `ReaderHandlersLive` types
 * its requirements with: this layer provides the services they name, so only
 * the type keeps them.
 */
export const httpLayer = (
  options: TestOptions = {}
): Layer.Layer<Environment, never, never> =>
  ReaderHandlersLive.pipe(
    Layer.provideMerge(environmentLayer(options))
  ) as unknown as Layer.Layer<Environment, never, never>;

/**
 * Serves one raw web request through the real router and handlers, so a test
 * can send a body the generated client refuses to encode. The cast drops the
 * request-level markers `HttpRouter` unwraps at run time: the test's
 * environment already holds the services they name. A decoding failure is a
 * defect, which the server answers from its Respondable symbol (400, no body).
 */
export const rawCall = (request: Request) =>
  Effect.gen(function* () {
    const handler = yield* HttpRouter.toHttpEffect(
      HttpApiBuilder.layer(ReaderApi)
    );
    const call = handler as unknown as Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      unknown,
      HttpServerRequest.HttpServerRequest | Scope.Scope
    >;
    const exit = yield* Effect.exit(
      Effect.scoped(
        call.pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromWeb(request)
          )
        )
      )
    );
    if (Exit.isSuccess(exit)) {
      return HttpServerResponse.toWeb(exit.value);
    }

    const response = yield* Respondable.toResponseOrElse(
      Cause.squash(exit.cause),
      HttpServerResponse.empty({ status: 500 })
    );

    return HttpServerResponse.toWeb(response);
  });
