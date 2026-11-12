import { describe, expect, it } from '@effect/vitest';
import { Option, Result, Schema } from 'effect';
import { SavedPage } from '../../../src/entity/saved-page/saved-page';
import { makeSavedPage } from '../../support';

const lowerCaseUuidV7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const decode = Schema.decodeUnknownResult(SavedPage);

const storedPage = Schema.encodeSync(SavedPage)(makeSavedPage());

const withoutKey = (row: object, key: string): object =>
  Object.fromEntries(Object.entries(row).filter(([name]) => name !== key));

describe('SavedPage', () => {
  it('makes a fresh lower-case version 7 uuid when none is given', () => {
    const first = makeSavedPage();
    const second = makeSavedPage();

    expect(first.id).toMatch(lowerCaseUuidV7);
    expect(second.id).toMatch(lowerCaseUuidV7);
    expect(second.id > first.id).toBe(true);
  });

  it('keeps a given id', () => {
    const page = makeSavedPage();

    expect(Result.getOrThrow(decode({ ...storedPage, id: page.id })).id).toBe(
      page.id
    );
  });

  it('requires a url', () => {
    expect(Result.isFailure(decode(withoutKey(storedPage, 'url')))).toBe(true);
    expect(Result.isFailure(decode({ ...storedPage, url: 'not a url' }))).toBe(
      true
    );
    expect(
      Result.isFailure(decode({ ...storedPage, url: 'ftp://host/page' }))
    ).toBe(true);
  });

  it('requires content', () => {
    expect(Result.isFailure(decode(withoutKey(storedPage, 'content')))).toBe(
      true
    );
  });

  it('starts unread with an empty description and no publish time', () => {
    const page = makeSavedPage();

    expect(page.read).toBe(false);
    expect(page.description).toEqual(Option.none());
    expect(page.publishedAt).toEqual(Option.none());
  });
});
