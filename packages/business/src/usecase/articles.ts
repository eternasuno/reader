import { Effect, Option } from 'effect';
import type { Article, ArticleId } from '../entity/article';
import type { FeedId, OwnerId } from '../entity/object-value';
import {
  ArticleExtractError,
  ArticleExtractor,
} from '../port/article-extractor';
import { ArticleRepository } from '../port/article-repository';
import { HtmlParser } from '../port/html-parser';
import { WebpageFetcher, WebpageFetcherFactory } from '../port/webpage-fetcher';
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

const fetchAndExtract = (owner: OwnerId, sourceUrl: URL) =>
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
    const content = Option.getOrUndefined(extracted.content);
    if (content === undefined || content.trim() === '') {
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
  const article: Article = {
    id: articleId(
      owner,
      undefined,
      url,
      extracted.title,
      Option.getOrUndefined(extracted.description)
    ),
    ownerId: owner,
    feedId: Option.none(),
    url: Option.some(url),
    title: extracted.title,
    description: extracted.description,
    content: Option.some(extracted.content),
    extractedContent: Option.some(extracted.content),
    publishedAt: extracted.publishedAt,
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
  if (Option.isNone(source.feedId)) {
    return yield* new ArticleNotInFeed({
      message: 'Article is not part of a subscription',
    });
  }

  const copy: Article = {
    id: articleId(
      owner,
      undefined,
      Option.getOrUndefined(source.url),
      source.title,
      Option.getOrUndefined(source.description)
    ),
    ownerId: owner,
    feedId: Option.none(),
    url: source.url,
    title: source.title,
    description: source.description,
    content: source.content,
    extractedContent: source.extractedContent,
    publishedAt: source.publishedAt,
    read: false,
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
  if (Option.isSome(article.extractedContent)) {
    return { item: article };
  }

  if (Option.isNone(article.url)) {
    return yield* new ArticleMissingUrl({
      message: 'Article has no source URL',
    });
  }

  const extracted = yield* fetchAndExtract(owner, article.url.value);
  const saved = yield* articles.saveExtracted(owner, id, extracted.content);
  if (!saved) {
    return yield* new ArticleNotFound({ message: 'Article not found' });
  }

  return {
    item: { ...article, extractedContent: Option.some(extracted.content) },
  };
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
  if (Option.isSome(found) && Option.isSome(found.value.feedId)) {
    return yield* new ArticleNotLater({
      message: 'Subscription articles cannot be removed directly',
    });
  }

  if (Option.isSome(found)) {
    yield* articles.removeLater(owner, id);
  }

  return { ok: true as const };
});
