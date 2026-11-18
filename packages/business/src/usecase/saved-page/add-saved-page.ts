import { Effect, Option } from 'effect';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import type { OwnerId } from '../../entity/common/owner-id';
import { SavedPage } from '../../entity/saved-page/saved-page';
import {
  SavedPageAlreadyExists,
  type SavedPageRepositoryError,
} from '../../error/saved-page';
import { SavedPageRepository } from '../../port/saved-page-repository';
import {
  type FetchAndExtractError,
  type FetchAndExtractPorts,
  fetchAndExtract,
} from '../common/fetch-and-extract';

/**
 * Adds one link to the read-later list (SP-ADD): the duplicate is looked up
 * before anything is fetched (SP-ADD-1, SP-ID-4), the article is fetched and
 * extracted (CM-FETCH), and the page is stored unread with the submitted
 * normalized URL (SP-ADD-2). Its publish time is the extracted one or none
 * (SP-ADD-4). A failure saves nothing (SP-ADD-3), a lost race to the unique URL
 * fails as a duplicate without another lookup (SP-ADD-5), and the new id is
 * made by the entity constructor (CM-ID-3).
 */
export const addSavedPage = Effect.fn('addSavedPage')(function* (
  owner: OwnerId,
  url: NormalizedUrl
) {
  const pages = yield* SavedPageRepository;
  const existing = yield* pages.findByUrl(owner, url);

  if (Option.isSome(existing)) {
    return yield* new SavedPageAlreadyExists({ url });
  }

  const article = yield* fetchAndExtract(url);
  const page = yield* SavedPage.makeEffect({
    ownerId: owner,
    url,
    title: article.title,
    description: article.description,
    content: article.content,
    publishedAt: article.publishedAt,
    read: false,
  }).pipe(Effect.orDie);
  const created = yield* pages.create(owner, [page]);

  if (created.length === 0) {
    return yield* new SavedPageAlreadyExists({ url });
  }

  return page;
});

/** The failures of one added link (SP-ADD-3, SP-ADD-5). */
export type AddSavedPageError =
  | SavedPageAlreadyExists
  | SavedPageRepositoryError
  | FetchAndExtractError;

/** The ports one added link runs on (SP-ADD). */
export type AddSavedPagePorts = SavedPageRepository | FetchAndExtractPorts;
