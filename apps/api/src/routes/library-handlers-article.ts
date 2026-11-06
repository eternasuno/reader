import {
  type ArticleCursor,
  ArticleCursorFromString,
  ArticleRepository,
  addArticle,
  extractArticle,
  getArticle,
  InvalidArticleUrl,
  InvalidCursor,
  listLaterArticles,
  markArticle,
  markArticlesRead,
  markFeedsRead,
  markLaterRead,
  NormalizedUrl,
  refreshLaterArticles,
  removeArticle,
  saveArticle,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import { webpageFetcherForOwner } from '../adapter/webpage-fetcher';
import {
  type HandlerRequest,
  optionToNull,
  withSession,
} from './library-contract';
import {
  addFailure,
  articleFailure,
  articlePageFailure,
  extractFailure,
  removeFailure,
  saveFailure,
} from './library-failures';

const invalidCursor = () =>
  new InvalidCursor({ message: 'Invalid pagination cursor' });

const cursor = (value: string): Effect.Effect<ArticleCursor, InvalidCursor> =>
  Schema.decodeEffect(ArticleCursorFromString)(value).pipe(
    Effect.mapError(invalidCursor)
  );

const optionalCursor = (
  value: Option.Option<string>
): Effect.Effect<ArticleCursor | undefined, InvalidCursor> =>
  Option.match(value, {
    onNone: () => Effect.succeed(undefined),
    onSome: cursor,
  });

const laterList = ({ query }: HandlerRequest<'laterList'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const after = yield* optionalCursor(query.cursor);
      const through = yield* optionalCursor(query.through);

      return yield* listLaterArticles(
        owner,
        Option.getOrElse(query.filter, () => 'all'),
        after,
        through
      );
    })
  ).pipe(Effect.catchTags(articlePageFailure));

const laterRefresh = ({ query }: HandlerRequest<'laterRefresh'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const through = yield* cursor(query.through);

      return yield* Effect.map(
        refreshLaterArticles(
          owner,
          Option.getOrElse(query.filter, () => 'all'),
          through
        ),
        (items) => ({ items })
      );
    })
  ).pipe(Effect.catchTags(articlePageFailure));

const unreadCounts = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;

      return yield* articles.unreadCounts(owner);
    })
  ).pipe(Effect.catchTags(articleFailure));

const article = ({ query }: HandlerRequest<'article'>) =>
  withSession((owner) =>
    Effect.map(getArticle(owner, query.id), (found) => ({
      item: optionToNull(found),
    }))
  ).pipe(Effect.catchTags(articleFailure));

const add = ({ payload }: HandlerRequest<'addArticle'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const url = yield* Schema.decodeEffect(NormalizedUrl)(payload.url).pipe(
        Effect.mapError(
          () =>
            new InvalidArticleUrl({
              message: 'Article URL must use HTTP or HTTPS',
            })
        )
      );
      const layer = yield* webpageFetcherForOwner(owner);

      const item = yield* addArticle(owner, url).pipe(Effect.provide(layer));

      return { item };
    })
  ).pipe(Effect.catchTags(addFailure));

const save = ({ payload }: HandlerRequest<'saveArticle'>) =>
  withSession((owner) =>
    Effect.map(saveArticle(owner, payload.id), (item) => ({ item }))
  ).pipe(Effect.catchTags(saveFailure));

const extract = ({ payload }: HandlerRequest<'extractArticle'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const layer = yield* webpageFetcherForOwner(owner);

      const item = yield* extractArticle(owner, payload.id).pipe(
        Effect.provide(layer)
      );

      return { item };
    })
  ).pipe(Effect.catchTags(extractFailure));

const markRead = ({ payload }: HandlerRequest<'markRead'>) =>
  withSession((owner) =>
    markArticle(owner, payload.id, payload.read).pipe(
      Effect.as({ ok: true as const })
    )
  ).pipe(Effect.catchTags(articleFailure));

const markLater = () =>
  withSession((owner) =>
    markLaterRead(owner).pipe(Effect.as({ ok: true as const }))
  ).pipe(Effect.catchTags(articleFailure));

const markFeeds = ({ payload }: HandlerRequest<'markFeeds'>) =>
  withSession((owner) =>
    markFeedsRead(owner, payload.feedIds).pipe(Effect.as({ ok: true as const }))
  ).pipe(Effect.catchTags(articleFailure));

const markArticles = ({ payload }: HandlerRequest<'markArticles'>) =>
  withSession((owner) =>
    markArticlesRead(owner, payload.ids).pipe(Effect.as({ ok: true as const }))
  ).pipe(Effect.catchTags(articleFailure));

const remove = ({ payload }: HandlerRequest<'removeArticle'>) =>
  withSession((owner) =>
    removeArticle(owner, payload.id).pipe(Effect.as({ ok: true as const }))
  ).pipe(Effect.catchTags(removeFailure));

export const articleHandlers = {
  laterList,
  laterRefresh,
  unreadCounts,
  article,
  addArticle: add,
  saveArticle: save,
  extractArticle: extract,
  markRead,
  markLater,
  markFeeds,
  markArticles,
  removeArticle: remove,
};
