import {
  FeedFetcher,
  FeedPreviewStore,
  WebpageFetcher,
} from '@reader/business';
import { WebpageFetcherLive } from '@reader/webpage';
import { HttpFetchLive } from '@reader/webpage/http';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { ArticleExtractorLive } from './adapter/article-extractor';
import { ArticleRepositoryLive } from './adapter/article-repository';
import { FeedRepositoryLive } from './adapter/feed-repository';
import { LinkRepositoryLive } from './adapter/link-repository';
import { LinkTitleLive } from './adapter/link-title';
import { ReaderCredentialsLive } from './adapter/reader-credentials';
import { Auth } from './infrastructure/auth';
import { CredentialCryptoLive } from './infrastructure/credential-crypto';
import { authRoutes } from './routes/auth';
import { linkRoutes } from './routes/links';

export const AppLive = Layer.unwrap(
  Effect.gen(function* () {
    const auth = yield* Auth;
    const previews = yield* FeedPreviewStore;
    const fetcher = yield* FeedFetcher;
    const webpageFetcher = yield* Effect.provide(
      WebpageFetcher,
      WebpageFetcherLive
    );

    return Layer.mergeAll(
      authRoutes,
      linkRoutes.pipe(
        HttpRouter.provideRequest(
          Layer.mergeAll(
            ArticleRepositoryLive,
            ReaderCredentialsLive.pipe(Layer.provide(CredentialCryptoLive)),
            Layer.succeed(WebpageFetcher, webpageFetcher),
            ArticleExtractorLive,
            LinkRepositoryLive,
            LinkTitleLive,
            FeedRepositoryLive,
            HttpFetchLive
          )
        )
      )
    ).pipe(
      HttpRouter.provideRequest(
        Layer.mergeAll(
          Layer.succeed(Auth, auth),
          Layer.succeed(FeedPreviewStore, previews),
          Layer.succeed(FeedFetcher, fetcher)
        )
      )
    );
  })
);
