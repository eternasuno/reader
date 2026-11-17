import {
  addSavedPage,
  listSavedPages,
  SavedPageRepository,
  saveFeedItem,
} from '@reader/business';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { ReaderApi } from '../../contract';
import { decodePageUrl, pageInput } from './decode';
import { handle } from './errors';
import { webpageFetcherFor } from './fetcher';

/** One page of `稍后阅读` (SP-LIST, CM-PAGE). */
const list = HttpApiBuilder.handler(
  ReaderApi,
  'saved-page',
  'listSavedPages',
  ({ query }) =>
    handle((owner) =>
      Effect.map(listSavedPages(owner, pageInput(query)), (page) => ({
        items: [...page.items],
        cursor: page.cursor,
      }))
    )
);

/** The owner's unread count (SP-COUNT-1). */
const unreadCount = HttpApiBuilder.handler(
  ReaderApi,
  'saved-page',
  'savedPageUnreadCount',
  () =>
    handle((owner) =>
      Effect.map(
        Effect.flatMap(SavedPageRepository, (pages) =>
          pages.unreadCount(owner)
        ),
        (count) => ({ count })
      )
    )
);

/** The client's lookup after a duplicate (SP-ID-4); a bad URL is not an error. */
const lookup = HttpApiBuilder.handler(
  ReaderApi,
  'saved-page',
  'lookupSavedPage',
  ({ query }) =>
    Effect.matchEffect(decodePageUrl(query.url), {
      onFailure: () => Effect.succeed({ item: null }),
      onSuccess: (url) =>
        handle((owner) =>
          Effect.map(
            Effect.flatMap(SavedPageRepository, (pages) =>
              pages.findByUrl(owner, url)
            ),
            (found) => ({ item: Option.getOrNull(found) })
          )
        ),
    })
);

/** One page, `item: null` for an unknown or foreign id (SP-OPEN). */
const get = HttpApiBuilder.handler(
  ReaderApi,
  'saved-page',
  'getSavedPage',
  ({ params }) =>
    handle((owner) =>
      Effect.map(
        Effect.flatMap(SavedPageRepository, (pages) =>
          pages.find(owner, params.id)
        ),
        (found) => ({ item: Option.getOrNull(found) })
      )
    )
);

/** Adds one link, fetching it with the owner's fetcher (SP-ADD, CM-FETCH-2). */
const add = HttpApiBuilder.handler(
  ReaderApi,
  'saved-page',
  'addSavedPage',
  ({ payload }) =>
    Effect.gen(function* () {
      const url = yield* decodePageUrl(payload.url);
      const item = yield* handle((owner) =>
        addSavedPage(owner, url).pipe(Effect.provide(webpageFetcherFor(owner)))
      );

      return { item };
    })
);

/** Copies one feed item into the list (SP-SAVE). */
const save = HttpApiBuilder.handler(
  ReaderApi,
  'saved-page',
  'saveFeedItem',
  ({ params }) =>
    handle((owner) =>
      saveFeedItem(owner, params.id).pipe(
        Effect.provide(webpageFetcherFor(owner))
      )
    ).pipe(Effect.map((item) => ({ item })))
);

/** One page's read state (SP-READ). */
const markOne = HttpApiBuilder.handler(
  ReaderApi,
  'saved-page',
  'markSavedPage',
  ({ params, payload }) =>
    handle((owner) =>
      Effect.flatMap(SavedPageRepository, (pages) =>
        pages.markRead(owner, [params.id], payload.read)
      )
    )
);

/** The loaded rows marked read; unknown ids are ignored (SP-READ, CM-PORT-5). */
const markMany = HttpApiBuilder.handler(
  ReaderApi,
  'saved-page',
  'markSavedPages',
  ({ payload }) =>
    handle((owner) =>
      Effect.flatMap(SavedPageRepository, (pages) =>
        pages.markRead(owner, payload.ids, true)
      )
    )
);

/** Every page of the owner marked read (SP-READ-3). */
const markAll = HttpApiBuilder.handler(
  ReaderApi,
  'saved-page',
  'markAllSavedPages',
  () =>
    handle((owner) =>
      Effect.flatMap(SavedPageRepository, (pages) => pages.markAllRead(owner))
    )
);

/** Removal; an unknown or foreign id changes nothing (SP-REMOVE-1). */
const remove = HttpApiBuilder.handler(
  ReaderApi,
  'saved-page',
  'removeSavedPage',
  ({ params }) =>
    handle((owner) =>
      Effect.flatMap(SavedPageRepository, (pages) =>
        pages.remove(owner, [params.id])
      )
    )
);

export const SavedPageHandlersLive = HttpApiBuilder.group(
  ReaderApi,
  'saved-page',
  (handlers) =>
    handlers.handleAll({
      listSavedPages: list,
      savedPageUnreadCount: unreadCount,
      lookupSavedPage: lookup,
      getSavedPage: get,
      addSavedPage: add,
      saveFeedItem: save,
      markSavedPage: markOne,
      markSavedPages: markMany,
      markAllSavedPages: markAll,
      removeSavedPage: remove,
    })
);
