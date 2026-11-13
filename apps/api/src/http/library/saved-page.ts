import {
  addSavedPage as addSavedPageUseCase,
  listSavedPages,
  type SavedPageId,
  SavedPageRepository,
  saveFeedItem,
} from '@reader/business';
import { Effect } from 'effect';
import {
  addSavedPageFailure,
  savedPageRepositoryFailure,
  saveFeedItemFailure,
} from './failures';
import { decodePageUrl } from './input';
import {
  fetcherFor,
  type HandlerRequest,
  handle,
  handleOk,
  optionToNull,
} from './session';

const savedPages = ({ query }: HandlerRequest<'savedPages'>) =>
  handle(savedPageRepositoryFailure, (owner) =>
    listSavedPages(owner, {
      unreadOnly: query.unreadOnly,
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    })
  );

const savedPage = ({ query }: HandlerRequest<'savedPage'>) =>
  handle(savedPageRepositoryFailure, (owner) =>
    Effect.flatMap(SavedPageRepository, (repository) =>
      Effect.map(repository.find(owner, query.id), (found) => ({
        item: optionToNull(found),
      }))
    )
  );

const savedPageByUrl = ({ query }: HandlerRequest<'savedPageByUrl'>) =>
  handle(savedPageRepositoryFailure, (owner) =>
    Effect.matchEffect(decodePageUrl(query.url), {
      onFailure: () => Effect.succeed({ item: null }),
      onSuccess: (url) =>
        Effect.flatMap(SavedPageRepository, (repository) =>
          Effect.map(repository.findByUrl(owner, url), (found) => ({
            item: optionToNull(found),
          }))
        ),
    })
  );

const add = ({ payload }: HandlerRequest<'addSavedPage'>) =>
  handle(addSavedPageFailure, (owner) =>
    Effect.gen(function* () {
      const url = yield* decodePageUrl(payload.url);
      const fetcher = yield* fetcherFor(owner);
      const item = yield* addSavedPageUseCase(owner, url).pipe(
        Effect.provide(fetcher)
      );

      return { item };
    })
  );

const saveFromFeedItem = ({ payload }: HandlerRequest<'saveFeedItem'>) =>
  handle(saveFeedItemFailure, (owner) =>
    Effect.gen(function* () {
      const fetcher = yield* fetcherFor(owner);
      const item = yield* saveFeedItem(owner, payload.id).pipe(
        Effect.provide(fetcher)
      );

      return { item };
    })
  );

const markRead = (ids: ReadonlyArray<SavedPageId>, read: boolean) =>
  handleOk(savedPageRepositoryFailure, (owner) =>
    Effect.flatMap(SavedPageRepository, (repository) =>
      repository.markRead(owner, ids, read)
    )
  );

const markOne = ({ payload }: HandlerRequest<'markSavedPage'>) =>
  markRead([payload.id], payload.read);

const markMany = ({ payload }: HandlerRequest<'markSavedPages'>) =>
  markRead(payload.ids, true);

const markAll = () =>
  handleOk(savedPageRepositoryFailure, (owner) =>
    Effect.flatMap(SavedPageRepository, (repository) =>
      repository.markAllRead(owner)
    )
  );

const remove = ({ payload }: HandlerRequest<'removeSavedPage'>) =>
  handleOk(savedPageRepositoryFailure, (owner) =>
    Effect.flatMap(SavedPageRepository, (repository) =>
      repository.remove(owner, [payload.id])
    )
  );

const unread = () =>
  handle(savedPageRepositoryFailure, (owner) =>
    Effect.flatMap(SavedPageRepository, (repository) =>
      Effect.map(repository.unreadCount(owner), (count) => ({ count }))
    )
  );

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
