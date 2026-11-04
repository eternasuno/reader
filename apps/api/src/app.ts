import { BrowserConcurrencyLive } from '@reader/webpage';
import { HttpFetchLive } from '@reader/webpage/http';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { ArticleExtractorLive } from './adapter/article-extractor';
import { DocumentSantizeLive } from './adapter/document-santize';
import { FeedParserLive } from './adapter/feed-parser';
import { HtmlParserLive } from './adapter/html-parser';
import { ReaderStoreLive } from './adapter/reader-store';
import { SettingsRepositoryLive } from './adapter/settings-repository';
import type { Auth } from './infrastructure/auth';
import { FeedHttpClientLive } from './infrastructure/feed-http-client';
import { authRoutes } from './routes/auth';
import { libraryRoutes } from './routes/library';

export const LibraryServicesLive = Layer.mergeAll(
  ReaderStoreLive,
  SettingsRepositoryLive,
  ArticleExtractorLive,
  BrowserConcurrencyLive,
  HtmlParserLive,
  FeedHttpClientLive,
  FeedParserLive,
  DocumentSantizeLive,
  HttpFetchLive
);

export type LibraryServices = Layer.Success<typeof LibraryServicesLive>;

export const AppLive = Layer.unwrap(
  Effect.gen(function* () {
    const context = yield* Effect.context<Auth | LibraryServices>();

    return Layer.mergeAll(authRoutes, libraryRoutes).pipe(
      HttpRouter.provideRequest(Layer.succeedContext(context))
    );
  })
);
