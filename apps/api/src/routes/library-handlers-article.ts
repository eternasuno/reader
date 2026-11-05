import {
  ArticleRepository,
  addArticle,
  extractArticle,
  getArticle,
  listLaterArticles,
  markArticle,
  markArticlesRead,
  markFeedsRead,
  markLaterRead,
  refreshLaterArticles,
  removeArticle,
  saveArticle,
} from '@reader/business';
import { Effect, Option } from 'effect';
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

const laterList = ({ query }: HandlerRequest<'laterList'>) =>
  withSession((owner) =>
    listLaterArticles(
      owner,
      Option.getOrElse(query.filter, () => 'all'),
      Option.getOrUndefined(query.cursor),
      Option.getOrUndefined(query.through)
    )
  ).pipe(Effect.catchTags(articlePageFailure));

const laterRefresh = ({ query }: HandlerRequest<'laterRefresh'>) =>
  withSession((owner) =>
    Effect.map(
      refreshLaterArticles(
        owner,
        Option.getOrElse(query.filter, () => 'all'),
        query.through
      ),
      (items) => ({ items })
    )
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
      const layer = yield* webpageFetcherForOwner(owner);

      return yield* addArticle(owner, payload.url).pipe(Effect.provide(layer));
    })
  ).pipe(Effect.catchTags(addFailure));

const save = ({ payload }: HandlerRequest<'saveArticle'>) =>
  withSession((owner) => saveArticle(owner, payload.id)).pipe(
    Effect.catchTags(saveFailure)
  );

const extract = ({ payload }: HandlerRequest<'extractArticle'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const layer = yield* webpageFetcherForOwner(owner);

      return yield* extractArticle(owner, payload.id).pipe(
        Effect.provide(layer)
      );
    })
  ).pipe(Effect.catchTags(extractFailure));

const markRead = ({ payload }: HandlerRequest<'markRead'>) =>
  withSession((owner) => markArticle(owner, payload.id, payload.read)).pipe(
    Effect.catchTags(articleFailure)
  );

const markLater = () =>
  withSession(markLaterRead).pipe(Effect.catchTags(articleFailure));

const markFeeds = ({ payload }: HandlerRequest<'markFeeds'>) =>
  withSession((owner) => markFeedsRead(owner, payload.feedIds)).pipe(
    Effect.catchTags(articleFailure)
  );

const markArticles = ({ payload }: HandlerRequest<'markArticles'>) =>
  withSession((owner) => markArticlesRead(owner, payload.ids)).pipe(
    Effect.catchTags(articleFailure)
  );

const remove = ({ payload }: HandlerRequest<'removeArticle'>) =>
  withSession((owner) => removeArticle(owner, payload.id)).pipe(
    Effect.catchTags(removeFailure)
  );

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
