import type { Ref } from 'effect';
import type { Feed } from '../../../../src/entity/feed/feed';
import type { FeedItem } from '../../../../src/entity/feed/feed-item';
import type { Folder } from '../../../../src/entity/feed/folder';

export type MemoryFeedState = {
  readonly feeds: ReadonlyArray<Feed>;
  readonly items: ReadonlyArray<FeedItem>;
  readonly folders: ReadonlyArray<Folder>;
};

export type Ref_ = Ref.Ref<MemoryFeedState>;

export const compareText = (left: string, right: string): number =>
  left < right ? -1 : Number(left > right);

export const byTitleThenId = (left: Feed, right: Feed): number =>
  compareText(left.title, right.title) || compareText(left.id, right.id);

export const byNameThenId = (left: Folder, right: Folder): number =>
  compareText(left.name, right.name) || compareText(left.id, right.id);

export const byIdDescending = (
  left: { readonly id: string },
  right: { readonly id: string }
): number => compareText(right.id, left.id);
