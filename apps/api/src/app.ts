import { Effect, Layer } from 'effect';
import { FetchHttpClient, HttpRouter } from 'effect/http';
import { ArticleExtractorLive } from './adapter/article-extractor';
import { DocumentSanitizerLive } from './adapter/document-sanitizer';
import { FeedParserLive } from './adapter/feed-parser';
import { HtmlParserLive } from './adapter/html-parser';
import { ReaderStoreLive } from './adapter/reader-store';
import { SettingRepositoryLive } from './adapter/setting-repository';
import type { Auth } from './infrastructure/auth';
import type { FeedRefreshQueue } from './infrastructure/feed-refresh-queue';
import { authRoutes } from './routes/auth';
import { libraryRoutes } from './routes/library';

export const LibraryServicesLive = Layer.mergeAll(
  ReaderStoreLive,
  SettingRepositoryLive,
  ArticleExtractorLive,
  HtmlParserLive,
  FetchHttpClient.layer,
  FeedParserLive,
  DocumentSanitizerLive
);

type LibraryServices = Layer.Success<typeof LibraryServicesLive>;

export const AppLive = Layer.unwrap(
  Effect.gen(function* () {
    const context = yield* Effect.context<
      Auth | LibraryServices | FeedRefreshQueue
    >();

    return Layer.mergeAll(authRoutes, libraryRoutes).pipe(
      HttpRouter.provideRequest(Layer.succeedContext(context))
    );
  })
);
