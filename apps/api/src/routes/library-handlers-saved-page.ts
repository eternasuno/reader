import {
  addSavedPage,
  findSavedPage,
  listSavedPages,
  markAllSavedPagesRead,
  markSavedPages,
  NormalizedUrl,
  removeSavedPage,
  SettingsRepository,
  saveFeedItem,
} from '@reader/business';
import { Data, Effect, Option, Schema } from 'effect';
import {
  type HandlerRequest,
  optionalCursor,
  optionToNull,
  webpageFetcherLayerFor,
  withSession,
} from './library-contract';
import {
  addSavedPageFailure,
  savedPageFailure,
  savedPagePageFailure,
  saveFeedItemFailure,
} from './library-failures';

class InvalidPageUrl extends Data.TaggedError('InvalidPageUrl')<{
  readonly message: string;
}> {}

const savedPages = ({ query }: HandlerRequest<'savedPages'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const after = yield* optionalCursor(query.cursor);

      return yield* listSavedPages(
        owner,
        Option.getOrElse(query.filter, () => 'all'),
        after
      );
    })
  ).pipe(Effect.catchTags(savedPagePageFailure));

const savedPage = ({ query }: HandlerRequest<'savedPage'>) =>
  withSession((owner) =>
    Effect.map(findSavedPage(owner, query.id), (found) => ({
      item: optionToNull(found),
    }))
  ).pipe(Effect.catchTags(savedPageFailure));

const add = ({ payload }: HandlerRequest<'addSavedPage'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const url = yield* Schema.decodeEffect(NormalizedUrl)(payload.url).pipe(
        Effect.mapError(
          () =>
            new InvalidPageUrl({
              message: 'Page URL must use HTTP or HTTPS',
            })
        )
      );
      const settings = yield* SettingsRepository;
      const config = yield* settings.get(owner);

      const item = yield* addSavedPage(owner, url).pipe(
        Effect.provide(webpageFetcherLayerFor(config))
      );

      return { item };
    })
  ).pipe(Effect.catchTags(addSavedPageFailure));

const saveFromFeedItem = ({ payload }: HandlerRequest<'saveFeedItem'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;
      const config = yield* settings.get(owner);

      const item = yield* saveFeedItem(owner, payload.feedId, payload.id).pipe(
        Effect.provide(webpageFetcherLayerFor(config))
      );

      return { item };
    })
  ).pipe(Effect.catchTags(saveFeedItemFailure));

const markOne = ({ payload }: HandlerRequest<'markSavedPage'>) =>
  withSession((owner) =>
    markSavedPages(owner, [payload.id], payload.read).pipe(
      Effect.as({ ok: true as const })
    )
  ).pipe(Effect.catchTags(savedPageFailure));

const markMany = ({ payload }: HandlerRequest<'markSavedPages'>) =>
  withSession((owner) =>
    markSavedPages(owner, payload.ids, true).pipe(
      Effect.as({ ok: true as const })
    )
  ).pipe(Effect.catchTags(savedPageFailure));

const markAll = () =>
  withSession((owner) =>
    markAllSavedPagesRead(owner).pipe(Effect.as({ ok: true as const }))
  ).pipe(Effect.catchTags(savedPageFailure));

const remove = ({ payload }: HandlerRequest<'removeSavedPage'>) =>
  withSession((owner) =>
    removeSavedPage(owner, payload.id).pipe(Effect.as({ ok: true as const }))
  ).pipe(Effect.catchTags(savedPageFailure));

export const savedPageHandlers = {
  savedPages,
  savedPage,
  addSavedPage: add,
  saveFeedItem: saveFromFeedItem,
  markSavedPage: markOne,
  markSavedPages: markMany,
  markAllSavedPages: markAll,
  removeSavedPage: remove,
};
