import { describe, expect, it } from '@effect/vitest';
import { Clock, Effect, Option, Result, Schema } from 'effect';
import {
  ArticleContent,
  ArticleTitle,
} from '../../../src/entity/common/article';
import { NormalizedUrl } from '../../../src/entity/common/normalized-url';
import { OwnerId } from '../../../src/entity/common/owner-id';
import { Feed, FeedId, FeedTitle } from '../../../src/entity/feed/feed';
import { FeedItem, FeedItemId } from '../../../src/entity/feed-item/feed-item';
import {
  Folder,
  FolderId,
  FolderName,
} from '../../../src/entity/folder/folder';
import {
  SavedPage,
  SavedPageId,
} from '../../../src/entity/saved-page/saved-page';

const alice = OwnerId.make('alice');

const url = Schema.decodeSync(NormalizedUrl)('https://example.com/post');

const title = ArticleTitle.make('Post');

const makeFolder = (): Folder =>
  Folder.make({ ownerId: alice, name: FolderName.make('Tech') });

const makeFeed = (): Feed =>
  Feed.make({
    ownerId: alice,
    url,
    title: FeedTitle.make('Feed'),
    folderId: Option.none(),
    updatedAt: Option.none(),
  });

const makeFeedItem = (): FeedItem =>
  FeedItem.make({
    ownerId: alice,
    feedId: makeFeed().id,
    url,
    title,
    description: Option.none(),
    content: Option.none(),
    extractedContent: Option.none(),
    publishedAt: Option.none(),
    read: false,
  });

const makeSavedPage = (): SavedPage =>
  SavedPage.make({
    ownerId: alice,
    url,
    title,
    description: Option.none(),
    content: ArticleContent.make('<p>body</p>'),
    publishedAt: Option.none(),
    read: false,
  });

/** A full clock, so the id default reads the time it is given (CM-ID-2). */
const clockAt = (millis: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => millis,
  currentTimeMillis: Effect.succeed(millis),
  currentTimeNanosUnsafe: () => BigInt(millis) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(millis) * 1_000_000n),
  monotonicTimeNanosUnsafe: () => BigInt(millis) * 1_000_000n,
  monotonicTimeNanos: Effect.succeed(BigInt(millis) * 1_000_000n),
  sleep: () => Effect.void,
});

const makeFolderIdAt = (millis: number): FolderId =>
  Effect.runSync(
    Effect.provideService(
      Folder.makeEffect({ ownerId: alice, name: FolderName.make('Tech') }),
      Clock.Clock,
      clockAt(millis)
    )
  ).id;

const sortsAfter = (later: string, earlier: string): boolean => later > earlier;

describe('Ids', () => {
  it('CM-ID-1 makes every id greater than the id made before it, across the entity types', () => {
    let previous: { readonly id: string } = makeFeed();

    for (const make of [
      makeFolder,
      makeFeedItem,
      makeSavedPage,
      makeFeed,
      makeFolder,
      makeFeedItem,
      makeSavedPage,
    ]) {
      const next = make();

      expect(sortsAfter(next.id, previous.id)).toBe(true);
      previous = next;
    }
  });

  it('CM-ID-2 keeps that order when several ids are made in the same millisecond', () => {
    let previous = makeFolderIdAt(1_000);

    for (let sample = 0; sample < 16; sample++) {
      const next = makeFolderIdAt(1_000);

      expect(sortsAfter(next, previous)).toBe(true);
      previous = next;
    }
  });

  it('CM-ID-2 keeps that order when the clock stalls or goes back', () => {
    let previous = makeFolderIdAt(1_000);

    for (const millis of [1_000, 999, 500, 500, 0]) {
      const next = makeFolderIdAt(millis);

      expect(sortsAfter(next, previous)).toBe(true);
      previous = next;
    }
  });
});

describe('Id values', () => {
  it('CM-ID-3 decodes only a lower-case version-7 uuid', () => {
    const valid = '018f4c8e-7b2a-7c3d-8e4f-5a6b7c8d9e0f';
    const invalid = [
      valid.toUpperCase(),
      '018f4c8e-7b2a-4c3d-8e4f-5a6b7c8d9e0f',
      'not-a-uuid',
      '',
    ];

    for (const idSchema of [FeedId, FeedItemId, FolderId, SavedPageId]) {
      const decode = Schema.decodeUnknownResult(idSchema);

      expect(Result.isSuccess(decode(valid))).toBe(true);

      for (const input of invalid) {
        expect(Result.isFailure(decode(input))).toBe(true);
      }
    }
  });

  it('CM-ID-5 makes an id with the latest realm timestamp when the clock is behind it', () => {
    const live = makeFolder();
    const behind = makeFolderIdAt(0);

    expect(Schema.is(FolderId)(behind)).toBe(true);
    expect(sortsAfter(behind, live.id)).toBe(true);
  });
});
