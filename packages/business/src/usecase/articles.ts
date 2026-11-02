import { DateTime, Effect, Option } from 'effect';
import type { Article } from '../entity/article';
import type { ArticleId, FeedId, OwnerId } from '../entity/object-value';
import {
  ArticleExtractError,
  ArticleExtractor,
  type ExtractedArticle,
} from '../port/article-extractor';
import { ArticleRepository } from '../port/article-repository';
import { HtmlParser } from '../port/html-parser';
import type { SettingsRepositoryReadError } from '../port/settings-repository';
import {
  type WebpageFetchError,
  WebpageFetcher,
  WebpageFetcherFactory,
} from '../port/webpage-fetcher';
import {
  ArticleEmptyContent,
  ArticleMissingUrl,
  ArticleNotFound,
  ArticleNotInFeed,
  ArticleNotLater,
  DuplicateArticle,
  InvalidArticleUrl,
} from './article-errors';
import { articleId, normalizeUrl } from './identity';

export {
  ArticleEmptyContent,
  ArticleMissingUrl,
  ArticleNotFound,
  ArticleNotInFeed,
  ArticleNotLater,
  DuplicateArticle,
  InvalidArticleUrl,
  InvalidCursor,
} from './article-errors';
export {
  listFeedArticles,
  listLaterArticles,
  refreshFeedArticles,
  refreshLaterArticles,
} from './article-list';

const UNTITLED = 'Untitled';

const fetchAndExtract = (
  owner: OwnerId,
  sourceUrl: URL
): Effect.Effect<
  ExtractedArticle,
  | SettingsRepositoryReadError
  | WebpageFetchError
  | ArticleExtractError
  | ArticleEmptyContent,
  ArticleExtractor | HtmlParser | WebpageFetcherFactory
> =>
  Effect.gen(function* () {
    const factory = yield* WebpageFetcherFactory;
    const fetcherLayer = yield* factory.forOwner(owner);
    const html = yield* Effect.gen(function* () {
      const fetcher = yield* WebpageFetcher;

      return yield* fetcher.fetch(sourceUrl.href);
    }).pipe(Effect.provide(fetcherLayer));
    const parser = yield* HtmlParser;
    const document = yield* parser.parse(html, sourceUrl).pipe(
      Effect.mapError(
        () =>
          new ArticleExtractError({
            error: 'Unable to extract article content; open the original page',
          })
      )
    );
    const extractor = yield* ArticleExtractor;
    const extracted = yield* extractor.extract(document);
    const content = extracted.content;
    if (content.trim() === '') {
      return yield* new ArticleEmptyContent({
        message: 'Article content is empty',
      });
    }

    return {
      ...extracted,
      title: extracted.title.trim() || UNTITLED,
      content,
    };
  }).pipe(Effect.scoped);

export const getArticle = Effect.fn('articles.get')(function* (
  owner: OwnerId,
  id: ArticleId
) {
  const articles = yield* ArticleRepository;

  return yield* articles.find(owner, id);
});

export const addArticle = Effect.fn('articles.add')(function* (
  owner: OwnerId,
  value: string
) {
  const url = yield* Effect.try({
    try: () => normalizeUrl(value),
    catch: () =>
      new InvalidArticleUrl({ message: 'Article URL must use HTTP or HTTPS' }),
  });
  const extracted = yield* fetchAndExtract(owner, url);
  const publishedAt = extracted.publishedAt ?? (yield* DateTime.now);
  const article: Article = {
    id: articleId(
      owner,
      undefined,
      url,
      extracted.title,
      extracted.description
    ),
    ownerId: owner,
    url,
    title: extracted.title,
    ...(extracted.description === undefined
      ? {}
      : { description: extracted.description }),
    content: extracted.content,
    extractedContent: extracted.content,
    publishedAt,
    read: false,
  };
  const articles = yield* ArticleRepository;
  const created = yield* articles.create(owner, [article]);
  if (created.length === 0) {
    return yield* new DuplicateArticle({
      id: article.id,
      message: 'Article already exists',
    });
  }

  return { item: article };
});

export const saveArticle = Effect.fn('articles.save')(function* (
  owner: OwnerId,
  id: ArticleId
) {
  const articles = yield* ArticleRepository;
  const found = yield* articles.find(owner, id);
  if (Option.isNone(found)) {
    return yield* new ArticleNotFound({ message: 'Article not found' });
  }

  const source = found.value;
  if (source.feedId === undefined) {
    return yield* new ArticleNotInFeed({
      message: 'Article is not part of a subscription',
    });
  }

  const copy: Article = {
    id: articleId(
      owner,
      undefined,
      source.url,
      source.title,
      source.description
    ),
    ownerId: owner,
    title: source.title,
    publishedAt: source.publishedAt,
    read: false,
    ...(source.url === undefined ? {} : { url: source.url }),
    ...(source.description === undefined
      ? {}
      : { description: source.description }),
    ...(source.content === undefined ? {} : { content: source.content }),
    ...(source.extractedContent === undefined
      ? {}
      : { extractedContent: source.extractedContent }),
  };
  const created = yield* articles.create(owner, [copy]);
  if (created.length === 0) {
    return yield* new DuplicateArticle({
      id: copy.id,
      message: 'Article is already in later reading',
    });
  }

  return { item: copy };
});

export const extractArticle = Effect.fn('articles.extract')(function* (
  owner: OwnerId,
  id: ArticleId
) {
  const articles = yield* ArticleRepository;
  const found = yield* articles.find(owner, id);
  if (Option.isNone(found)) {
    return yield* new ArticleNotFound({ message: 'Article not found' });
  }

  const article = found.value;
  if (article.extractedContent !== undefined) {
    return { item: article };
  }

  if (article.url === undefined) {
    return yield* new ArticleMissingUrl({
      message: 'Article has no source URL',
    });
  }

  const extracted = yield* fetchAndExtract(owner, article.url);
  const saved = yield* articles.saveExtracted(owner, id, extracted.content);
  if (!saved) {
    return yield* new ArticleNotFound({ message: 'Article not found' });
  }

  return { item: { ...article, extractedContent: extracted.content } };
});

export const markArticle = Effect.fn('articles.mark')(function* (
  owner: OwnerId,
  id: ArticleId,
  read: boolean
) {
  const articles = yield* ArticleRepository;
  yield* articles.setRead(owner, [id], read);

  return { ok: true as const };
});

export const markLaterRead = Effect.fn('articles.markLater')(function* (
  owner: OwnerId
) {
  const articles = yield* ArticleRepository;
  yield* articles.markLater(owner);

  return { ok: true as const };
});

export const markFeedsRead = Effect.fn('articles.markFeeds')(function* (
  owner: OwnerId,
  ids: readonly FeedId[]
) {
  const articles = yield* ArticleRepository;
  yield* articles.markFeeds(owner, ids);

  return { ok: true as const };
});

export const markArticlesRead = Effect.fn('articles.markArticles')(function* (
  owner: OwnerId,
  ids: readonly ArticleId[]
) {
  const articles = yield* ArticleRepository;
  yield* articles.setRead(owner, ids, true);

  return { ok: true as const };
});

export const removeArticle = Effect.fn('articles.remove')(function* (
  owner: OwnerId,
  id: ArticleId
) {
  const articles = yield* ArticleRepository;
  const found = yield* articles.find(owner, id);
  if (Option.isSome(found) && found.value.feedId !== undefined) {
    return yield* new ArticleNotLater({
      message: 'Subscription articles cannot be removed directly',
    });
  }

  if (Option.isSome(found)) {
    yield* articles.removeLater(owner, id);
  }

  return { ok: true as const };
});
