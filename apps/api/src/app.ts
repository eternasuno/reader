import { WebpageFetcherLive } from '@reader/webpage';
import { HttpFetchLive } from '@reader/webpage/http';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { ArticleExtractorLive } from './adapter/article-extractor';
import { ContentProcessorLive } from './adapter/content-processor';
import { ExtractionSettingsLive } from './adapter/extraction-settings';
import { ReaderCredentialsLive } from './adapter/reader-credentials';
import { ReaderStoreLive } from './adapter/reader-store';
import { SyndicationLive } from './adapter/syndication';
import type { Auth } from './infrastructure/auth';
import { CredentialCryptoLive } from './infrastructure/credential-crypto';
import { authRoutes } from './routes/auth';
import { libraryRoutes } from './routes/library';

export const LibraryServicesLive = Layer.mergeAll(
  ReaderStoreLive,
  ExtractionSettingsLive,
  ReaderCredentialsLive,
  ArticleExtractorLive,
  WebpageFetcherLive,
  SyndicationLive,
  ContentProcessorLive,
  HttpFetchLive
).pipe(Layer.provide(CredentialCryptoLive));

export type LibraryServices = Layer.Success<typeof LibraryServicesLive>;

export const AppLive = Layer.unwrap(
  Effect.gen(function* () {
    const context = yield* Effect.context<Auth | LibraryServices>();

    return Layer.mergeAll(authRoutes, libraryRoutes).pipe(
      HttpRouter.provideRequest(Layer.succeedContext(context))
    );
  })
);
