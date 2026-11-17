import { Effect } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type {
  SavedPage,
  SavedPageId,
} from '../../entity/saved-page/saved-page';
import type { SavedPageRepositoryError } from '../../error/saved-page';
import { SavedPageRepository } from '../../port/saved-page-repository';
import { type PageInput, pageOf, pageQuery } from '../common/paging';

/**
 * One page of the read-later list (SP-LIST): the owner's pages, newest first
 * (SP-LIST-1, SP-LIST-2), narrowed by the unread filter (CM-PAGE-8) and paged
 * by id descending with the cursor of the previous page (CM-PAGE-1, CM-PAGE-4).
 * Listing again from the first page applies the filter afresh (SP-LIST-3).
 */
export const listSavedPages = Effect.fn('listSavedPages')(function* (
  owner: OwnerId,
  input: PageInput<SavedPageId>
) {
  const pages = yield* SavedPageRepository;
  const rows = yield* pages.list(owner, pageQuery(input));

  return pageOf<SavedPageId, SavedPage>(rows, input.limit);
});

/** The only failure of one page of the list (SP-LIST). */
export type ListSavedPagesError = SavedPageRepositoryError;

/** The ports one page of the list runs on (SP-LIST). */
export type ListSavedPagesPorts = SavedPageRepository;
