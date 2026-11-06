import {
  type ArticleCursor,
  ArticleCursorFromString,
  ArticleRepository,
  addArticle,
  extractArticle,
  InvalidArticleUrl,
  InvalidCursor,
  listLaterArticles,
  NormalizedUrl,
  refreshLaterArticles,
  removeArticle,
  type Setting,
  SettingsRepository,
  saveArticle,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import {
  browserWebpageFetcherLive,
  jinaWebpageFetcherLive,
} from '../adapter/webpage-fetcher';
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
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;
      const found = yield* articles.find(owner, query.id);

      return { item: optionToNull(found) };
    })
  ).pipe(Effect.catchTags(articleFailure));

const webpageFetcherLayerFor = (config: Setting) =>
  config.fetcher.provider === 'jina'
    ? jinaWebpageFetcherLive(Option.getOrUndefined(config.fetcher.key))
    : browserWebpageFetcherLive(config.fetcher.endpoint);

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
      const settings = yield* SettingsRepository;
      const config = yield* settings.get(owner);
      const fetcherLayer = webpageFetcherLayerFor(config);

      const item = yield* addArticle(owner, url).pipe(
        Effect.provide(fetcherLayer)
      );

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
      const settings = yield* SettingsRepository;
      const config = yield* settings.get(owner);
      const fetcherLayer = webpageFetcherLayerFor(config);

      const item = yield* extractArticle(owner, payload.id).pipe(
        Effect.provide(fetcherLayer)
      );

      return { item };
    })
  ).pipe(Effect.catchTags(extractFailure));

const markRead = ({ payload }: HandlerRequest<'markRead'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;
      yield* articles.updateByArticleIds(owner, [payload.id], {
        read: payload.read,
      });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(articleFailure));

const markLater = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;
      yield* articles.updateLater(owner, { read: true });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(articleFailure));

const markFeeds = ({ payload }: HandlerRequest<'markFeeds'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;
      yield* articles.updateFeeds(owner, Option.some(payload.feedIds), {
        read: true,
      });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(articleFailure));

const markArticles = ({ payload }: HandlerRequest<'markArticles'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;
      yield* articles.updateByArticleIds(owner, payload.ids, { read: true });

      return { ok: true as const };
    })
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
