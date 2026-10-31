import { Context, Data, type Effect } from 'effect';
import type { FeedImport } from '../entity/feed-import';

export class FeedPreviewStoreError extends Data.TaggedError(
  'FeedPreviewStoreError'
)<{
  readonly error: string;
}> {}

export type PendingFeedPreview = {
  readonly owner: string;
  readonly url: string;
  readonly imported: FeedImport;
  readonly expiresAt: number;
};

export class FeedPreviewStore extends Context.Service<
  FeedPreviewStore,
  {
    readonly save: (
      preview: PendingFeedPreview,
      now: number
    ) => Effect.Effect<string, FeedPreviewStoreError>;
    readonly find: (
      owner: string,
      token: string,
      now: number
    ) => Effect.Effect<PendingFeedPreview | undefined>;
  }
>()('@reader/business/FeedPreviewStore') {}
