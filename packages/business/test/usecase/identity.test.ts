import { expect, it } from '@effect/vitest';
import { Option, Schema } from 'effect';
import { FeedItem } from '../../src/entity/feed/feed-item';
import {
  ArticleDescription,
  ArticleTitle,
} from '../../src/entity/object-value/article';
import { NormalizedUrl } from '../../src/entity/object-value/normalized-url';
import { OptionFromOptionalNonEmpty } from '../../src/entity/object-value/option-from-optional-non-empty';
import { OwnerId } from '../../src/entity/object-value/owner-id';
import { SavedPage } from '../../src/entity/saved-page/saved-page';
import { feedId, feedItemId, savedPageId } from '../../src/usecase/identity';

const owner = OwnerId.make('alice');

const otherOwner = OwnerId.make('bob');

const normalizeUrl = Schema.decodeUnknownSync(NormalizedUrl);

const decodeTitle = Schema.decodeUnknownSync(ArticleTitle);

const decodeDescription = Schema.decodeUnknownSync(
  OptionFromOptionalNonEmpty(ArticleDescription)
);

it('rejects malformed and non-HTTP(S) URLs while preserving credentials', () => {
  expect(() => normalizeUrl('not a url')).toThrow(Schema.SchemaError);
  expect(() => normalizeUrl('ftp://example.com/feed')).toThrow(
    Schema.SchemaError
  );
  expect(() => normalizeUrl('javascript:alert(1)')).toThrow(Schema.SchemaError);
  expect(normalizeUrl('https://user:secret@example.com/feed').href).toBe(
    'https://user:secret@example.com/feed'
  );
});

it('removes tracking parameters case-insensitively and keeps the rest', () => {
  const url = normalizeUrl(
    'HTTPS://Example.COM:443/a/../b?UTM_Source=x&B=2&gClid=y&b=1#Frag'
  );
  expect(url.href).toBe('https://example.com/b?B=2&b=1#Frag');
});

it('removes repeated tracking parameters without touching similar names', () => {
  const url = normalizeUrl(
    'https://example.com/feed?utm_source_extra=1&MSCLKID=2&ok=3&msclkid=4'
  );
  expect(url.href).toBe('https://example.com/feed?utm_source_extra=1&ok=3');
});

it('defaults blank titles and trims surrounding space when decoding', () => {
  expect(decodeTitle('  ')).toBe('Untitled');
  expect(decodeTitle('  Title  ')).toBe('Title');
});

it('trims descriptions and maps blank ones to none when decoding', () => {
  expect(decodeDescription('  Description  ')).toEqual(
    Option.some('Description')
  );
  expect(decodeDescription('  ')).toEqual(Option.none());
  expect(decodeDescription('')).toEqual(Option.none());
  expect(decodeDescription(undefined)).toEqual(Option.none());
});

it('derives a stable feed identity from the owner and normalized URL', () => {
  const normalized = normalizeUrl('https://example.com/feed');
  const equivalent = normalizeUrl('https://Example.com:443/feed?utm_source=x');
  expect(feedId(owner, equivalent)).toBe(feedId(owner, normalized));
  expect(feedId(owner, normalized)).not.toBe(feedId(otherOwner, normalized));
  expect(feedId(owner, normalized)).not.toBe(
    feedId(owner, normalizeUrl('https://example.com/other'))
  );
});

const feed = feedId(owner, normalizeUrl('https://example.com/feed'));

const otherFeed = feedId(owner, normalizeUrl('https://example.com/other'));

const feedItem = (overrides: Partial<Parameters<typeof feedItemId>[0]> = {}) =>
  feedItemId({
    feedId: feed,
    url: Option.some(normalizeUrl('https://example.com/post')),
    title: decodeTitle('Title'),
    description: decodeDescription(undefined),
    ...overrides,
  });

const savedPage = (
  overrides: Partial<Parameters<typeof savedPageId>[0]> = {}
) =>
  savedPageId({
    ownerId: owner,
    url: Option.some(normalizeUrl('https://example.com/post')),
    title: decodeTitle('Title'),
    description: decodeDescription(undefined),
    ...overrides,
  });

it('derives feed item identity from URL, text, and feed', () => {
  const url = normalizeUrl('https://Example.com:443/post?UTM_Source=x');

  expect(
    feedItem({
      url: Option.some(url),
      description: decodeDescription('Description'),
    })
  ).toBe(
    feedItem({
      url: Option.some(normalizeUrl('https://example.com/post')),
      description: decodeDescription('Description'),
    })
  );
});

it('scopes feed item identity by feed, url, and text', () => {
  expect(feedItem()).not.toBe(feedItem({ feedId: otherFeed }));
  expect(feedItem()).not.toBe(feedItem({ url: Option.none() }));
  expect(feedItem()).not.toBe(feedItem({ title: decodeTitle('Other') }));
  expect(feedItem()).not.toBe(
    feedItem({ description: decodeDescription('Other') })
  );
});

it('preserves title case in feed item identities', () => {
  expect(feedItem({ title: decodeTitle('New  Post') })).not.toBe(
    feedItem({ title: decodeTitle('new post') })
  );
});

it('distinguishes linkless feed items by title', () => {
  expect(feedItem({ url: Option.none(), title: decodeTitle('One') })).not.toBe(
    feedItem({ url: Option.none(), title: decodeTitle('Two') })
  );
});

it('derives saved page identity from URL, text, and owner', () => {
  const url = normalizeUrl('https://Example.com:443/post?UTM_Source=x');

  expect(savedPage({ url: Option.some(url) })).toBe(savedPage());
  expect(savedPage()).not.toBe(savedPage({ ownerId: otherOwner }));
  expect(savedPage()).not.toBe(savedPage({ url: Option.none() }));
  expect(savedPage()).not.toBe(savedPage({ title: decodeTitle('Other') }));
});

it('keeps saved pages and feed items in separate identity spaces', () => {
  expect(savedPage()).not.toBe(feedItem());
});

it('encodes absent descriptions as omitted fields and present descriptions as strings', () => {
  const schema = Schema.Struct({
    description: OptionFromOptionalNonEmpty(ArticleDescription),
  });
  const decode = Schema.decodeSync(schema);
  const encode = Schema.encodeSync(schema);
  expect(decode({})).toEqual({ description: Option.none() });
  expect(encode(decode({ description: '  ' }))).toEqual({});
  expect(encode(decode({ description: '  Summary  ' }))).toEqual({
    description: 'Summary',
  });
});

it('normalizes both feed item content fields and preserves their encoding', () => {
  const schema = FeedItem.mapFields((fields) => ({
    content: fields.content,
    extractedContent: fields.extractedContent,
  }));
  const decode = Schema.decodeSync(schema);
  const encode = Schema.encodeSync(schema);
  expect(decode({})).toEqual({
    content: Option.none(),
    extractedContent: Option.none(),
  });
  expect(decode({ content: '  ', extractedContent: '' })).toEqual({
    content: Option.none(),
    extractedContent: Option.none(),
  });
  expect(encode(decode({ content: '  ', extractedContent: '' }))).toEqual({});
  expect(
    encode(
      decode({
        content: '  <p>Body</p>  ',
        extractedContent: '  <p>Extracted</p>  ',
      })
    )
  ).toEqual({ content: '<p>Body</p>', extractedContent: '<p>Extracted</p>' });
});

it('requires saved page content and trims it', () => {
  const schema = SavedPage.mapFields((fields) => ({
    content: fields.content,
  }));
  const decode = Schema.decodeUnknownSync(schema);

  expect(decode({ content: '  <p>Body</p>  ' })).toEqual({
    content: '<p>Body</p>',
  });
  expect(() => decode({})).toThrow();
});
