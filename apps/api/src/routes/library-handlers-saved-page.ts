import {
  addSavedPage as addSavedPageUseCase,
  listSavedPages,
  type SavedPageId,
  SavedPageRepository,
  saveFeedItem,
} from '@reader/business';
import { Effect } from 'effect';
import {
  fetcherFor,
  type HandlerRequest,
  optionToNull,
  withSession,
} from './library-contract';
import {
  addSavedPageFailure,
  savedPageRepositoryFailure,
  saveFeedItemFailure,
} from './library-failures';
import { decodePageUrl } from './library-input';

const savedPages = ({ query }: HandlerRequest<'savedPages'>) =>
  withSession((owner) =>
    listSavedPages(owner, {
      unreadOnly: query.unreadOnly,
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    })
  ).pipe(Effect.catchTags(savedPageRepositoryFailure));

const savedPage = ({ query }: HandlerRequest<'savedPage'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SavedPageRepository;
      const found = yield* repository.find(owner, query.id);

      return { item: optionToNull(found) };
    })
  ).pipe(Effect.catchTags(savedPageRepositoryFailure));

const savedPageByUrl = ({ query }: HandlerRequest<'savedPageByUrl'>) =>
  withSession((owner) =>
    Effect.matchEffect(decodePageUrl(query.url), {
      onFailure: () => Effect.succeed({ item: null }),
      onSuccess: (url) =>
        Effect.gen(function* () {
          const repository = yield* SavedPageRepository;
          const found = yield* repository.findByUrl(owner, url);

          return { item: optionToNull(found) };
        }),
    })
  ).pipe(Effect.catchTags(savedPageRepositoryFailure));

const add = ({ payload }: HandlerRequest<'addSavedPage'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const url = yield* decodePageUrl(payload.url);
      const fetcher = yield* fetcherFor(owner);
      const item = yield* addSavedPageUseCase(owner, url).pipe(
        Effect.provide(fetcher)
      );

      return { item };
    })
  ).pipe(Effect.catchTags(addSavedPageFailure));

const saveFromFeedItem = ({ payload }: HandlerRequest<'saveFeedItem'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const fetcher = yield* fetcherFor(owner);
      const item = yield* saveFeedItem(owner, payload.id).pipe(
        Effect.provide(fetcher)
      );

      return { item };
    })
  ).pipe(Effect.catchTags(saveFeedItemFailure));

const updateRead = (ids: ReadonlyArray<SavedPageId>, read: boolean) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SavedPageRepository;
      yield* repository.update(owner, ids, { read });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(savedPageRepositoryFailure));

const markOne = ({ payload }: HandlerRequest<'markSavedPage'>) =>
  updateRead([payload.id], payload.read);

const markMany = ({ payload }: HandlerRequest<'markSavedPages'>) =>
  updateRead(payload.ids, true);

const markAll = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SavedPageRepository;
      yield* repository.updateAll(owner, { read: true });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(savedPageRepositoryFailure));

const remove = ({ payload }: HandlerRequest<'removeSavedPage'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SavedPageRepository;
      yield* repository.remove(owner, [payload.id]);

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(savedPageRepositoryFailure));

const unread = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SavedPageRepository;

      return { count: yield* repository.unreadCount(owner) };
    })
  ).pipe(Effect.catchTags(savedPageRepositoryFailure));

export const savedPageHandlers = {
  savedPages,
  savedPage,
  savedPageByUrl,
  addSavedPage: add,
  saveFeedItem: saveFromFeedItem,
  markSavedPage: markOne,
  markSavedPages: markMany,
  markAllSavedPages: markAll,
  removeSavedPage: remove,
  savedPageUnread: unread,
};
