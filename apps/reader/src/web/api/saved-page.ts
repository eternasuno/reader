import { SavedPageApi } from '../../contract';
import {
  contractId,
  type EncodedSuccess,
  type ListPage,
  type ListQuery,
  listQuery,
  request,
  requestJson,
} from './client';

/** Saved pages (`稍后阅读`): the list, one page, marking read and removal (later.md). */

const { endpoints } = SavedPageApi;

/** One saved page in its wire (JSON) form. */
export type SavedPage = EncodedSuccess<typeof endpoints.addSavedPage>['item'];

/** Adds a link to `稍后阅读`; a duplicate answers `SavedPageAlreadyExists` (SP-ADD-5). */
export const addSavedPage = (url: string) =>
  requestJson(endpoints.addSavedPage, (client) =>
    client['saved-page'].addSavedPage({ payload: { url } })
  );

/** Saves a feed item to `稍后阅读` as a copy (SP-SAVE). */
export const saveFeedItem = (feedItemId: string) =>
  requestJson(endpoints.saveFeedItem, (client) =>
    client['saved-page'].saveFeedItem({
      params: { id: contractId(feedItemId) },
    })
  );

/** One page of the saved-page list, newest first (CM-PAGE-1). */
export const listSavedPages = (
  query: ListQuery
): Promise<ListPage<SavedPage>> =>
  requestJson(endpoints.listSavedPages, (client) =>
    client['saved-page'].listSavedPages({ query: listQuery(query) })
  );

/** The unread count of `稍后阅读` (LIB-COUNT). */
export const getSavedPageUnreadCount = () =>
  requestJson(endpoints.savedPageUnreadCount, (client) =>
    client['saved-page'].savedPageUnreadCount({})
  );

/** The saved page of an address, `null` when there is none (CM-ID-7). */
export const lookupSavedPage = (url: string) =>
  requestJson(endpoints.lookupSavedPage, (client) =>
    client['saved-page'].lookupSavedPage({ query: { url } })
  );

/** One saved page by id, `null` when it does not exist for the owner (CM-OWN-3). */
export const getSavedPage = (savedPageId: string) =>
  requestJson(endpoints.getSavedPage, (client) =>
    client['saved-page'].getSavedPage({
      params: { id: contractId(savedPageId) },
    })
  );

/** Marks one saved page read or unread; unknown ids are ignored (CM-PORT-5). */
export const markSavedPage = (savedPageId: string, read: boolean) =>
  request((client) =>
    client['saved-page'].markSavedPage({
      params: { id: contractId(savedPageId) },
      payload: { read },
    })
  );

/** Marks a list of saved pages read; an empty list changes nothing (CM-PORT-5). */
export const markSavedPages = (savedPageIds: ReadonlyArray<string>) =>
  request((client) =>
    client['saved-page'].markSavedPages({
      payload: { ids: savedPageIds.map((id) => contractId(id)) },
    })
  );

/** Marks every saved page read. */
export const markAllSavedPages = () =>
  request((client) => client['saved-page'].markAllSavedPages({}));

/** Removes a saved page; an unknown id changes nothing (CM-PORT-5). */
export const removeSavedPage = (savedPageId: string) =>
  request((client) =>
    client['saved-page'].removeSavedPage({
      params: { id: contractId(savedPageId) },
    })
  );
