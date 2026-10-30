import { LinksUnavailable, ReaderApi } from '@reader/api';
import {
  type FeedRepositoryError,
  type LinkRepositoryError,
  listFeedArticles,
  listFeeds,
  markAllFeedArticles,
  markFeedArticle,
  markLoadedFeedArticles,
  previewFeed,
  saveFeedArticle,
  subscribeFeed,
  unsubscribeFeed,
} from '@reader/business';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Session } from '../middleware/session';

const failure = <A, E, R>(
  effect: Effect.Effect<A, E | FeedRepositoryError | LinkRepositoryError, R>
) =>
  effect.pipe(
    Effect.catchTag(['FeedRepositoryError', 'LinkRepositoryError'], (error) =>
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

const startPreview = ({ payload }: { payload: { readonly url: string } }) =>
  withSession((owner) => previewFeed(owner, payload.url)).pipe(failure);

const confirmSubscription = ({
  payload,
}: {
  payload: { readonly token: string };
}) => withSession((owner) => subscribeFeed(owner, payload.token)).pipe(failure);

export const feedHandlers = HttpApiBuilder.group(ReaderApi, 'feeds', (group) =>
  group
    .handle('list', () => withSession(listFeeds).pipe(failure))
    .handle('preview', startPreview)
    .handle('subscribe', confirmSubscription)
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
