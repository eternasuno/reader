import { Data } from 'effect';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import type { FeedItemId } from '../../entity/feed/feed-item';
import type { FolderId, FolderName } from '../../entity/feed/folder';

export class FeedAlreadyExists extends Data.TaggedError('FeedAlreadyExists')<{
  readonly url: NormalizedUrl;
}> {}

export class FeedItemNotFound extends Data.TaggedError('FeedItemNotFound')<{
  readonly id: FeedItemId;
}> {}

export class FolderAlreadyExists extends Data.TaggedError(
  'FolderAlreadyExists'
)<{
  readonly folderName: FolderName;
}> {}

export class FolderNotFound extends Data.TaggedError('FolderNotFound')<{
  readonly id: FolderId;
}> {}

export class FetchFeedError extends Data.TaggedError('FetchFeedError')<{
  readonly message: string;
}> {}
