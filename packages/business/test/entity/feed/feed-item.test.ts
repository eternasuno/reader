import { describe, expect, it } from '@effect/vitest';
import { Schema } from 'effect';
import { FeedItemId } from '../../../src/entity/feed/feed-item';
import { makeFeedItem } from '../../support/fixtures';

describe('FeedItem', () => {
  it('FD-ID-2 makes a new lower-case version-7 id when imported and a later one sorts after it', () => {
    let previous = makeFeedItem();

    expect(Schema.is(FeedItemId)(previous.id)).toBe(true);
    expect(previous.id).toBe(previous.id.toLowerCase());

    for (let sample = 0; sample < 7; sample++) {
      const next = makeFeedItem();

      expect(next.id > previous.id).toBe(true);
      previous = next;
    }
  });
});
