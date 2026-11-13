import { Effect } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type {
  SavedPage,
  SavedPageId,
} from '../../entity/saved-page/saved-page';
import {
  SavedPageRepository,
  type SavedPageRepositoryError,
} from '../../port/saved-page-repository';
import { type Page, type PageInput, pageOf, pageQuery } from '../common/paging';

export type SavedPageListQuery = PageInput<SavedPageId>;

export const listSavedPages = (
  owner: OwnerId,
  query: SavedPageListQuery
): Effect.Effect<
  Page<SavedPage, SavedPageId>,
  SavedPageRepositoryError,
  SavedPageRepository
> =>
  Effect.gen(function* () {
    const repository = yield* SavedPageRepository;
    const rows = yield* repository.list(owner, pageQuery(query));

    return pageOf<SavedPageId, SavedPage>(rows, query.limit);
  });
