import { describe, expect, it } from '@effect/vitest';
import { Clock, Effect, Result, Schema } from 'effect';
import { OwnerId } from '../../../src/entity/common/owner-id';
import { FeedId } from '../../../src/entity/feed/feed';
import { FeedItemId } from '../../../src/entity/feed/feed-item';
import { Folder, FolderId, FolderName } from '../../../src/entity/feed/folder';
import { SavedPageId } from '../../../src/entity/saved-page/saved-page';
import {
  makeFeed,
  makeFeedItem,
  makeFolder,
  makeSavedPage,
} from '../../support/fixtures';

const sortsAfter = (later: string, earlier: string): boolean => later > earlier;

const clockAt = (millis: number): Clock.Clock =>
  ({ currentTimeMillisUnsafe: () => millis }) as unknown as Clock.Clock;

const makeFolderAt = (millis: number): Folder =>
  Effect.runSync(
    Effect.provideService(
      Folder.makeEffect({
        ownerId: OwnerId.make('alice'),
        name: FolderName.make('Tech'),
      }),
      Clock.Clock,
      clockAt(millis)
    )
  );

describe('Ids', () => {
  it('CM-ID-1 makes every id greater than the id made before it', () => {
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

  it('CM-ID-2 keeps that order in one millisecond and when the clock stalls or goes back', () => {
    let previous = makeFolderAt(1_000);

    for (let sample = 0; sample < 16; sample++) {
      const next = makeFolderAt(1_000);

      expect(sortsAfter(next.id, previous.id)).toBe(true);
      previous = next;
    }

    for (const millis of [1_000, 999, 500, 500, 0]) {
      const next = makeFolderAt(millis);

      expect(sortsAfter(next.id, previous.id)).toBe(true);
      previous = next;
    }
  });

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
});
