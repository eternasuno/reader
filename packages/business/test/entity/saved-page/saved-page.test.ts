import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { makeSavedPage } from '../../support';

describe('SavedPage', () => {
  it('starts unread with an empty description and no publish time', () => {
    const page = makeSavedPage();

    expect(page.read).toBe(false);
    expect(page.description).toEqual(Option.none());
    expect(page.publishedAt).toEqual(Option.none());
  });
});
