import { describe, expect, it } from '@effect/vitest';
import { Option, Result, Schema } from 'effect';
import {
  ArticleContent,
  ArticleTitle,
} from '../../../src/entity/common/article';
import { NormalizedUrl } from '../../../src/entity/common/normalized-url';
import { OwnerId } from '../../../src/entity/common/owner-id';
import {
  SavedPage,
  SavedPageId,
} from '../../../src/entity/saved-page/saved-page';

const alice = OwnerId.make('alice');

const url = Schema.decodeSync(NormalizedUrl)('https://example.com/post');

const makeSavedPage = (): SavedPage =>
  SavedPage.make({
    ownerId: alice,
    url,
    title: ArticleTitle.make('Post'),
    description: Option.none(),
    content: ArticleContent.make('<p>body</p>'),
    publishedAt: Option.none(),
    read: false,
  });

describe('SavedPage', () => {
  it('SP-ID-1 makes a lower-case version-7 id when the page is created', () => {
    const page = makeSavedPage();

    expect(Schema.is(SavedPageId)(page.id)).toBe(true);
    expect(page.id).toBe(page.id.toLowerCase());
  });

  it('SP-ADD starts the page unread with no description and no publish time', () => {
    const page = makeSavedPage();

    expect(page.read).toBe(false);
    expect(page.description).toEqual(Option.none());
    expect(page.publishedAt).toEqual(Option.none());
  });

  it('SP-ADD-2 keeps the submitted normalized URL as the key', () => {
    const page = makeSavedPage();

    expect(page.url.href).toBe('https://example.com/post');
  });

  it('CM-ART-4 trims the stored content', () => {
    const page = Schema.decodeSync(SavedPage)({
      ...Schema.encodeUnknownSync(SavedPage)(makeSavedPage()),
      content: ' <p>body</p> ',
    });

    expect(page.content).toBe('<p>body</p>');
  });

  it('CM-ART-4 requires content: a page without it does not decode', () => {
    const stored = {
      id: makeSavedPage().id,
      ownerId: alice,
      url: url.href,
      title: 'Post',
      read: false,
    };

    expect(
      Result.isFailure(Schema.decodeUnknownResult(SavedPage)(stored))
    ).toBe(true);
  });

  it('omits an absent description and publish time from JSON instead of writing null', () => {
    const encoded = Schema.encodeUnknownSync(SavedPage)(makeSavedPage());

    expect(encoded.description).toBeUndefined();
    expect(encoded.publishedAt).toBeUndefined();
    expect(encoded.content).toBe('<p>body</p>');
  });
});
