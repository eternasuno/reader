import { LinksUnavailable, ReaderApi } from '@reader/api';
import { listLinks, markLink, removeLink, saveLink } from '@reader/business';
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

export const linkHandlers = HttpApiBuilder.group(ReaderApi, 'links', (group) =>
  group
    .handle('list', ({ query }) =>
      Effect.gen(function* () {
        const user = yield* Session;

        return yield* listLinks(
          user.id,
          query.read ?? false,
          query.offset ?? 0
        );
      }).pipe(databaseFailure)
    )
    .handle('add', ({ payload }) =>
      Effect.gen(function* () {
        const user = yield* Session;

        return yield* saveLink(user.id, payload.url);
      }).pipe(databaseFailure)
    )
    .handle('mark', ({ payload }) =>
      Effect.gen(function* () {
        const user = yield* Session;

        return yield* markLink(user.id, payload.key, payload.read);
      }).pipe(databaseFailure)
    )
    .handle('remove', ({ payload }) =>
      Effect.gen(function* () {
        const user = yield* Session;

        return yield* removeLink(user.id, payload.key);
      }).pipe(databaseFailure)
    )
);

export const linkRoutes = HttpApiBuilder.layer(ReaderApi).pipe(
  Layer.provide(Layer.mergeAll(linkHandlers, feedHandlers, readerHandlers)),

  Layer.provide(checkOrigin.layer),
  Layer.provide(sessionMiddleware.layer),
  Layer.provide(HttpServer.layerServices)
);
