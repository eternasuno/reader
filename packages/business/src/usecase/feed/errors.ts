import { Data } from 'effect';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import type { FeedItemId } from '../../entity/feed/feed-item';
import type { FolderId, FolderName } from '../../entity/feed/folder';

/** The owner already follows this URL (FD-SUB step 2). */
export class FeedAlreadyExists extends Data.TaggedError('FeedAlreadyExists')<{
  readonly url: NormalizedUrl;
}> {}

/** The item does not exist for this owner (FD-EXTRACT, SP-SAVE). */
export class FeedItemNotFound extends Data.TaggedError('FeedItemNotFound')<{
  readonly id: FeedItemId;
}> {}

/** The owner already has a folder of this name (FD-FOLDER-4, FD-FOLDER-5). */
export class FolderAlreadyExists extends Data.TaggedError(
  'FolderAlreadyExists'
)<{
  readonly folderName: FolderName;
}> {}

/** The folder does not exist for this owner (FD-FOLDER-5, FD-MOVE, FD-SUB). */
export class FolderNotFound extends Data.TaggedError('FolderNotFound')<{
  readonly id: FolderId;
}> {}

/**
 * The source could not be fetched, including a response that is not 2xx
 * (FD-FETCH-2).
 */
export class FetchFeedError extends Data.TaggedError('FetchFeedError')<{
  readonly message: string;
}> {}
