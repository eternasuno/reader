import { Effect, Option } from 'effect';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import type { OwnerId } from '../../entity/common/owner-id';
import { SavedPage } from '../../entity/saved-page/saved-page';
import type {
  ArticleExtractor,
  ArticleExtractorError,
} from '../../port/article-extractor';
import type { HtmlParser, HtmlParserError } from '../../port/html-parser';
import {
  SavedPageRepository,
  type SavedPageRepositoryError,
} from '../../port/saved-page-repository';
import type {
  WebpageFetcher,
  WebpageFetcherError,
} from '../../port/webpage-fetcher';
import type { ArticleEmptyContent } from '../common/errors';
import { fetchAndExtract } from '../common/fetch-and-extract';
import { SavedPageAlreadyExists } from './errors';

type FetchErrors =
  | WebpageFetcherError
  | HtmlParserError
  | ArticleExtractorError
  | ArticleEmptyContent;

type FetchServices = WebpageFetcher | HtmlParser | ArticleExtractor;

export const addSavedPage = (
  owner: OwnerId,
  url: NormalizedUrl
): Effect.Effect<
  SavedPage,
  SavedPageAlreadyExists | SavedPageRepositoryError | FetchErrors,
  SavedPageRepository | FetchServices
> =>
  Effect.gen(function* () {
    const repository = yield* SavedPageRepository;
    const existing = yield* repository.findByUrl(owner, url);

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
    const created = yield* repository.create(owner, [page]);

    if (created.length === 0) {
      return yield* new SavedPageAlreadyExists({ url });
    }

    return page;
  });
