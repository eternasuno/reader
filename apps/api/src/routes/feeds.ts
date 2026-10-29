import { LinksUnavailable, ReaderApi } from '@reader/api';
import {
  listFeedArticles,
  listFeeds,
  markAllFeedArticles,
  markFeedArticle,
  markLoadedFeedArticles,
  saveFeedArticle,
  subscribeFeed,
  unsubscribeFeed,
} from '@reader/business';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Session } from '../middleware/session';

const failure = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>
) =>
  effect.pipe(
    Effect.catchIf(
      (
        error
      ): error is Extract<
        E,
        { readonly _tag: 'FeedRepositoryError' | 'LinkRepositoryError' }
      > =>
        error._tag === 'FeedRepositoryError' ||
        error._tag === 'LinkRepositoryError',
      (error) =>
        Effect.logError('Feed operation failed', error).pipe(
          Effect.andThen(
            Effect.fail(
              new LinksUnavailable({ error: '暂时无法访问订阅，请稍后重试' })
            )
          )
        )
    )
  );

const withSession = <A, E, R>(use: (owner: string) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(Session, (user) => use(user.id));

export const feedHandlers = HttpApiBuilder.group(ReaderApi, 'feeds', (group) =>
  group
    .handle('list', () => withSession(listFeeds).pipe(failure))
    .handle('subscribe', ({ payload }) =>
      withSession((owner) => subscribeFeed(owner, payload.url)).pipe(failure)
    )
    .handle('unsubscribe', ({ payload }) =>
      withSession((owner) => unsubscribeFeed(owner, payload.key)).pipe(failure)
    )
    .handle('articles', ({ query }) =>
      withSession((owner) =>
        listFeedArticles(
          owner,
          query.feedKey,
          query.read ?? false,
          query.offset ?? 0,
          query.all ?? false,
          query.before ?? '',
          query.beforeKey ?? ''
        )
      ).pipe(failure)
    )
    .handle('mark', ({ payload }) =>
      withSession((owner) =>
        markFeedArticle(owner, payload.key, payload.read)
      ).pipe(failure)
    )
    .handle('markAll', ({ payload }) =>
      withSession((owner) => markAllFeedArticles(owner, payload.feedKey)).pipe(
        failure
      )
    )
    .handle('markLoaded', ({ payload }) =>
      withSession((owner) => markLoadedFeedArticles(owner, payload.keys)).pipe(
        failure
      )
    )
    .handle('save', ({ payload }) =>
      withSession((owner) => saveFeedArticle(owner, payload.key)).pipe(failure)
    )
);
