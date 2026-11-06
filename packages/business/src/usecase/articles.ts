import { Effect, Option } from 'effect';
import type { Article, ArticleId } from '../entity/article';
import type { NormalizedUrl, OwnerId } from '../entity/object-value';
import { ArticleExtractor } from '../port/article-extractor';
import { ArticleRepository } from '../port/article-repository';
import { HtmlParser } from '../port/html-parser';
import { WebpageFetcher } from '../port/webpage-fetcher';
import {
  ArticleEmptyContent,
  ArticleMissingUrl,
  ArticleNotFound,
  ArticleNotInFeed,
  ArticleNotLater,
  DuplicateArticle,
} from './article-errors';
import { articleId } from './identity';

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
  ArticlePage,
  listFeedArticles,
  listLaterArticles,
  refreshFeedArticles,
  refreshLaterArticles,
} from './article-list';

const fetchAndExtract = (sourceUrl: URL) =>
  Effect.gen(function* () {
    const fetcher = yield* WebpageFetcher;
    const html = yield* fetcher.fetch(sourceUrl.href);
    const parser = yield* HtmlParser;
    const document = yield* parser.parse(html, sourceUrl);
    const extractor = yield* ArticleExtractor;
    const extracted = yield* extractor.extract(document);
    if (Option.isNone(extracted.content)) {
      return yield* new ArticleEmptyContent({
        message: 'Article content is empty',
      });
    }

    return extracted;
  }).pipe(Effect.scoped);

export const addArticle = (owner: OwnerId, url: NormalizedUrl) =>
  Effect.gen(function* () {
    const extracted = yield* fetchAndExtract(url);
    const article: Article = {
      id: articleId({
        ownerId: owner,
        feedId: Option.none(),
        url: Option.some(url),
        title: extracted.title,
        description: extracted.description,
      }),
      ownerId: owner,
      feedId: Option.none(),
      url: Option.some(url),
      title: extracted.title,
      description: extracted.description,
      content: extracted.content,
      extractedContent: extracted.content,
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

    return article;
  });

export const saveArticle = (owner: OwnerId, id: ArticleId) =>
  Effect.gen(function* () {
    const articles = yield* ArticleRepository;
    const found = yield* articles.find(owner, id);
    if (Option.isNone(found)) {
      return yield* new ArticleNotFound({ message: 'Article not found' });
    }

    const source = found.value;
    if (Option.isNone(source.feedId)) {
      return yield* new ArticleNotInFeed({
        message: 'Article is not part of a feed',
      });
    }

    const copy: Article = {
      id: articleId({
        ownerId: owner,
        feedId: Option.none(),
        url: source.url,
        title: source.title,
        description: source.description,
      }),
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

    return copy;
  });

export const extractArticle = (owner: OwnerId, id: ArticleId) =>
  Effect.gen(function* () {
    const articles = yield* ArticleRepository;
    const found = yield* articles.find(owner, id);
    if (Option.isNone(found)) {
      return yield* new ArticleNotFound({ message: 'Article not found' });
    }

    const article = found.value;
    if (Option.isSome(article.extractedContent)) {
      return article;
    }

    if (Option.isNone(article.url)) {
      return yield* new ArticleMissingUrl({
        message: 'Article has no source URL',
      });
    }

    const extracted = yield* fetchAndExtract(article.url.value);
    const updated = yield* articles.updateByArticleIds(owner, [id], {
      extractedContent: extracted.content,
    });
    if (updated.length === 0) {
      return yield* new ArticleNotFound({ message: 'Article not found' });
    }

    return { ...article, extractedContent: extracted.content };
  });

export const removeArticle = (owner: OwnerId, id: ArticleId) =>
  Effect.gen(function* () {
    const articles = yield* ArticleRepository;
    const found = yield* articles.find(owner, id);
    if (Option.isSome(found) && Option.isSome(found.value.feedId)) {
      return yield* new ArticleNotLater({
        message: 'Feed articles cannot be removed directly',
      });
    }

    if (Option.isSome(found)) {
      yield* articles.removeLater(owner, [id]);
    }
  });
