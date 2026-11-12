import { DateTime, Effect, Option } from 'effect';
import type { OwnerId } from '../../src/entity/common/owner-id';
import type { Feed } from '../../src/entity/feed/feed';
import { FeedTitle } from '../../src/entity/feed/feed';
import type { FeedItem } from '../../src/entity/feed/feed-item';
import type { Folder, FolderId } from '../../src/entity/feed/folder';
import { FolderName } from '../../src/entity/feed/folder';
import type { FeedRepositoryError } from '../../src/port/feed-repository';
import { FeedRepository } from '../../src/port/feed-repository';
import { alice, makeUniqueFeed, makeUniqueFolder } from '../support';

export const feedRow = (title = 'Feed', owner = alice): Feed =>
  makeUniqueFeed({ ownerId: owner, title: FeedTitle.make(title) });

export const folderRow = (name: string, owner: OwnerId = alice): Folder =>
  makeUniqueFolder({ ownerId: owner, name: FolderName.make(name) });

export const folderFeedRow = (
  folderId: FolderId,
  owner: OwnerId = alice
): Feed => makeUniqueFeed({ ownerId: owner, folderId: Option.some(folderId) });

export const storedFolderFeed = (
  folderId: FolderId,
  owner: OwnerId = alice
): Effect.Effect<Feed, FeedRepositoryError, FeedRepository> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = folderFeedRow(folderId, owner);
    yield* feeds.create(owner, [feed]);

    return feed;
  });

export const rowAt = (rows: ReadonlyArray<FeedItem>, index: number): FeedItem =>
  Option.getOrThrow(Option.fromUndefinedOr(rows[index]));

export const updatedTime = (): DateTime.Utc =>
  DateTime.fromDateUnsafe(new Date('2026-01-01T00:00:00.000Z'));
