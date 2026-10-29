import { LinksUnavailable, ReaderApi } from '@reader/api';
import {
  countUnreadLinks,
  listLinks,
  markAllLinks,
  markLink,
  markLoadedLinks,
  removeLink,
  saveLink,
} from '@reader/business';
import { Effect, Layer } from 'effect';
import { HttpServer } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { checkOrigin } from '../middleware/origin';
import { Session, sessionMiddleware } from '../middleware/session';
import { feedHandlers } from './feeds';
import { readerHandlers } from './reader';

const databaseFailure = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>
) =>
  effect.pipe(
    Effect.catchIf(
      (error): error is Extract<E, { readonly _tag: 'LinkRepositoryError' }> =>
        error._tag === 'LinkRepositoryError',
      (cause) =>
        Effect.gen(function* () {
          yield* Effect.logError('Reading list unavailable', cause);

          return yield* new LinksUnavailable({
            error: '暂时无法访问阅读清单，请稍后重试',
          });
        })
    )
  );

const withSession = <A, E, R>(use: (owner: string) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(Session, (user) => use(user.id));

export const linkHandlers = HttpApiBuilder.group(ReaderApi, 'links', (group) =>
  group
    .handle('unreadCount', () =>
      withSession(countUnreadLinks).pipe(databaseFailure)
    )
    .handle('list', ({ query }) =>
      withSession((owner) =>
        listLinks(
          owner,
          query.read ?? false,
          query.offset ?? 0,
          query.all ?? false,
          query.before ?? '',
          query.beforeKey ?? ''
        )
      ).pipe(databaseFailure)
    )
    .handle('add', ({ payload }) =>
      withSession((owner) => saveLink(owner, payload.url)).pipe(databaseFailure)
    )
    .handle('mark', ({ payload }) =>
      withSession((owner) => markLink(owner, payload.key, payload.read)).pipe(
        databaseFailure
      )
    )
    .handle('markAll', () => withSession(markAllLinks).pipe(databaseFailure))
    .handle('markLoaded', ({ payload }) =>
      withSession((owner) => markLoadedLinks(owner, payload.keys)).pipe(
        databaseFailure
      )
    )
    .handle('remove', ({ payload }) =>
      withSession((owner) => removeLink(owner, payload.key)).pipe(
        databaseFailure
      )
    )
);

export const linkRoutes = HttpApiBuilder.layer(ReaderApi).pipe(
  Layer.provide(Layer.mergeAll(linkHandlers, feedHandlers, readerHandlers)),

  Layer.provide(checkOrigin.layer),
  Layer.provide(sessionMiddleware.layer),
  Layer.provide(HttpServer.layerServices)
);
