import { LinksUnavailable, ReaderApi } from '@reader/api';
import {
  listFeedArticles,
  listFeeds,
  markFeedArticle,
  refreshFeed,
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

export const feedHandlers = HttpApiBuilder.group(ReaderApi, 'feeds', (group) =>
  group
    .handle('list', () =>
      Effect.flatMap(Session, (user) => listFeeds(user.id)).pipe(failure)
    )
    .handle('subscribe', ({ payload }) =>
      Effect.flatMap(Session, (user) =>
        subscribeFeed(user.id, payload.url)
      ).pipe(failure)
    )
    .handle('unsubscribe', ({ payload }) =>
      Effect.flatMap(Session, (user) =>
        unsubscribeFeed(user.id, payload.key)
      ).pipe(failure)
    )
    .handle('refresh', ({ payload }) =>
      Effect.flatMap(Session, (user) => refreshFeed(user.id, payload.key)).pipe(
        failure
      )
    )
    .handle('articles', ({ query }) =>
      Effect.flatMap(Session, (user) =>
        listFeedArticles(user.id, query.feedKey, query.read, query.offset)
      ).pipe(failure)
    )
    .handle('mark', ({ payload }) =>
      Effect.flatMap(Session, (user) =>
        markFeedArticle(user.id, payload.key, payload.read)
      ).pipe(failure)
    )
    .handle('save', ({ payload }) =>
      Effect.flatMap(Session, (user) =>
        saveFeedArticle(user.id, payload.key)
      ).pipe(failure)
    )
);
