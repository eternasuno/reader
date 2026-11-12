import { Effect } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type {
  SavedPage,
  SavedPageId,
} from '../../entity/saved-page/saved-page';
import {
  type SavedPageQuery,
  SavedPageRepository,
  type SavedPageRepositoryError,
} from '../../port/saved-page-repository';

export type SavedPageListQuery = {
  readonly unreadOnly: boolean;
  readonly limit: number;
  readonly cursor?: SavedPageId;
};

export const listSavedPages = (
  owner: OwnerId,
  query: SavedPageListQuery
): Effect.Effect<
  {
    readonly items: ReadonlyArray<SavedPage>;
    readonly cursor: SavedPageId | null;
  },
  SavedPageRepositoryError,
  SavedPageRepository
> =>
  Effect.gen(function* () {
    const repository = yield* SavedPageRepository;
    const rows = yield* repository.list(owner, {
      unreadOnly: query.unreadOnly,
      limit: query.limit + 1,
      ...(query.cursor === undefined ? {} : { after: query.cursor }),
    } satisfies SavedPageQuery);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);

    return {
      items,
      cursor: rows.length > query.limit && last !== undefined ? last.id : null,
    };
  });
