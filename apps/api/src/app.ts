import { Effect, Layer } from 'effect';
import { FetchHttpClient, HttpRouter } from 'effect/http';
import type { Auth } from './auth';
import { ArticleExtractorLive } from './content/article-extractor';
import { DocumentSanitizerLive } from './content/document-sanitizer';
import { FeedParserLive } from './content/feed-parser';
import { HtmlParserLive } from './content/html-parser';
import { authRoutes } from './http/auth';
import { libraryRoutes } from './http/library';
import type { FeedRefreshQueue } from './refresh/queue';
import { ReaderStoreLive, SettingRepositoryLive } from './store';

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
