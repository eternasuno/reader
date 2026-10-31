import { expect } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  ArticleExtractError,
  ArticleExtractor,
  ArticleRepository,
  ArticleRepositoryError,
  ReaderCredentials,
  ReaderCredentialsError,
  readArticle,
  WebpageFetchError,
  WebpageFetcher,
} from '../../src';

export const repositoryDown = 'repository down';
export const credentialsDown = 'credentials down';
export const fetchDown = 'fetch down';
export const extractDown = 'extraction down';

export const cachedRepository = Layer.mock(ArticleRepository, {
  metadata: () =>
    Effect.succeed({
      title: 'Source',
      url: 'https://example.com/a',
      read: false,
    }),
  get: () => Effect.undefined,
  save: () => Effect.void,
});

export const failingRepository = Layer.mock(ArticleRepository, {
  metadata: () =>
    Effect.fail(new ArticleRepositoryError({ error: repositoryDown })),
});

export const browserCredentials = Layer.mock(ReaderCredentials, {
  provider: () => Effect.succeed('browser'),
  browserEndpoint: () => Effect.succeed('http://127.0.0.1:9222'),
});

export const failingCredentials = Layer.mock(ReaderCredentials, {
  provider: () =>
    Effect.fail(new ReaderCredentialsError({ error: credentialsDown })),
});

export const browserFetcher = Layer.mock(WebpageFetcher, {
  fetch: () => Effect.succeed('<html>browser</html>'),
});

export const failingFetcher = Layer.mock(WebpageFetcher, {
  fetch: () => Effect.fail(new WebpageFetchError({ error: fetchDown })),
});

export const failingExtractor = Layer.mock(ArticleExtractor, {
  extract: () => Effect.fail(new ArticleExtractError({ error: extractDown })),
});

export const noCredentials = Layer.mock(ReaderCredentials, {});
export const noFetcher = Layer.mock(WebpageFetcher, {});
export const noExtractor = Layer.mock(ArticleExtractor, {});

type ArticleLayers = Layer.Layer<
  ArticleRepository | ReaderCredentials | WebpageFetcher | ArticleExtractor
>;

export const expectPropagatedFailure = (
  layers: ArticleLayers,
  tag: string,
  message: string
) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(
      readArticle('alice', 'link', 'key', true, true)
    );
    expect(error._tag).toBe(tag);
    expect(error.error).toBe(message);
  }).pipe(Effect.provide(layers));
