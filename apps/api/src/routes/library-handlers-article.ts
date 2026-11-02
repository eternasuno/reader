import { Effect } from 'effect';
import { ArticleRepository } from '../../../../packages/business/src/port/article-repository.ts';
import {
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
} from '../../../../packages/business/src/usecase/articles.ts';
import {
  type HandlerRequest,
  optionToNull,
  withSession,
} from './library-contract';
import {
  addFailure,
  articlePageFailure,
  articleReadFailure,
  articleWriteFailure,
  extractFailure,
  removeFailure,
  saveFailure,
} from './library-failures';

const laterList = ({ query }: HandlerRequest<'laterList'>) =>
  withSession((owner) =>
    listLaterArticles(owner, query.filter ?? 'all', query.cursor, query.through)
  ).pipe(Effect.catchTags(articlePageFailure));

const laterRefresh = ({ query }: HandlerRequest<'laterRefresh'>) =>
  withSession((owner) =>
    Effect.map(
      refreshLaterArticles(owner, query.filter ?? 'all', query.through),
      (items) => ({ items })
    )
  ).pipe(Effect.catchTags(articlePageFailure));

const laterUnread = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;

      return { count: yield* articles.unreadLater(owner) };
    })
  ).pipe(Effect.catchTags(articleReadFailure));

const article = ({ query }: HandlerRequest<'article'>) =>
  withSession((owner) =>
    Effect.map(getArticle(owner, query.id), (found) => ({
      item: optionToNull(found),
    }))
  ).pipe(Effect.catchTags(articleReadFailure));

const add = ({ payload }: HandlerRequest<'addArticle'>) =>
  withSession((owner) => addArticle(owner, payload.url)).pipe(
    Effect.catchTags(addFailure)
  );

const save = ({ payload }: HandlerRequest<'saveArticle'>) =>
  withSession((owner) => saveArticle(owner, payload.id)).pipe(
    Effect.catchTags(saveFailure)
  );

const extract = ({ payload }: HandlerRequest<'extractArticle'>) =>
  withSession((owner) => extractArticle(owner, payload.id)).pipe(
    Effect.catchTags(extractFailure)
  );

const markRead = ({ payload }: HandlerRequest<'markRead'>) =>
  withSession((owner) => markArticle(owner, payload.id, payload.read)).pipe(
    Effect.catchTags(articleWriteFailure)
  );

const markLater = () =>
  withSession(markLaterRead).pipe(Effect.catchTags(articleWriteFailure));

const markFeeds = ({ payload }: HandlerRequest<'markFeeds'>) =>
  withSession((owner) => markFeedsRead(owner, payload.feedIds)).pipe(
    Effect.catchTags(articleWriteFailure)
  );

const markArticles = ({ payload }: HandlerRequest<'markArticles'>) =>
  withSession((owner) => markArticlesRead(owner, payload.ids)).pipe(
    Effect.catchTags(articleWriteFailure)
  );

const remove = ({ payload }: HandlerRequest<'removeArticle'>) =>
  withSession((owner) => removeArticle(owner, payload.id)).pipe(
    Effect.catchTags(removeFailure)
  );

export const articleHandlers = {
  laterList,
  laterRefresh,
  laterUnread,
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
