import { describe, expect, it } from '@effect/vitest';
import { Option, Schema } from 'effect';
import { SavedPageId } from '../../../src/entity/saved-page/saved-page';
import { makeSavedPage } from '../../support/fixtures';

describe('SavedPage', () => {
  it('SP-ID-1 makes a new lower-case version-7 id at construction and a later one sorts after it', () => {
    let previous = makeSavedPage();

    expect(Schema.is(SavedPageId)(previous.id)).toBe(true);
    expect(previous.id).toBe(previous.id.toLowerCase());

    for (let sample = 0; sample < 7; sample++) {
      const next = makeSavedPage();

      expect(next.id > previous.id).toBe(true);
      previous = next;
    }
  });

  it('starts unread with an empty description and no publish time', () => {
    const page = makeSavedPage();

    expect(page.read).toBe(false);
    expect(page.description).toEqual(Option.none());
    expect(page.publishedAt).toEqual(Option.none());
  });
});
