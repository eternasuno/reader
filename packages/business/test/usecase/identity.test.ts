import { expect, it } from '@effect/vitest';
import { Option, Schema } from 'effect';
import {
  Article,
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
} from '../../src/entity/article';
import { NormalizedUrl, OwnerId } from '../../src/entity/object-value';
import { articleId, feedId } from '../../src/usecase/identity';

const owner = OwnerId.make('alice');

const otherOwner = OwnerId.make('bob');

const normalizeUrl = Schema.decodeUnknownSync(NormalizedUrl);

const decodeTitle = Schema.decodeUnknownSync(ArticleTitle);

const decodeDescription = Schema.decodeUnknownSync(ArticleDescription);

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

it('trims descriptions when decoding', () => {
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

it('derives article identity from URL, text, and owner', () => {
  const url = normalizeUrl('https://Example.com:443/post?UTM_Source=x');
  expect(
    articleId({
      ownerId: owner,
      feedId: Option.none(),
      url: Option.some(url),
      title: decodeTitle('Title'),
      description: decodeDescription('Description'),
    })
  ).toBe(
    articleId({
      ownerId: owner,
      feedId: Option.none(),
      url: Option.some(normalizeUrl('https://example.com/post')),
      title: decodeTitle('Title'),
      description: decodeDescription('Description'),
    })
  );
});

it('preserves title case in article identities', () => {
  expect(
    articleId({
      ownerId: owner,
      feedId: Option.none(),
      url: Option.none(),
      title: decodeTitle('New  Post'),
      description: decodeDescription(undefined),
    })
  ).not.toBe(
    articleId({
      ownerId: owner,
      feedId: Option.none(),
      url: Option.none(),
      title: decodeTitle('new post'),
      description: decodeDescription(undefined),
    })
  );
});

it('scopes article identity by owner', () => {
  expect(
    articleId({
      ownerId: owner,
      feedId: Option.none(),
      url: Option.none(),
      title: decodeTitle('Title'),
      description: decodeDescription(undefined),
    })
  ).not.toBe(
    articleId({
      ownerId: otherOwner,
      feedId: Option.none(),
      url: Option.none(),
      title: decodeTitle('Title'),
      description: decodeDescription(undefined),
    })
  );
});

it('scopes article identity by url', () => {
  expect(
    articleId({
      ownerId: owner,
      feedId: Option.none(),
      url: Option.none(),
      title: decodeTitle('Title'),
      description: decodeDescription(undefined),
    })
  ).not.toBe(
    articleId({
      ownerId: owner,
      feedId: Option.none(),
      url: Option.some(normalizeUrl('https://example.com/a')),
      title: decodeTitle('Title'),
      description: decodeDescription(undefined),
    })
  );
});

it('uses the feed identity for feed articles and the owner otherwise', () => {
  const feed = feedId(owner, normalizeUrl('https://example.com/feed'));
  const otherFeed = feedId(owner, normalizeUrl('https://example.com/other'));
  const url = normalizeUrl('https://example.com/post');
  expect(
    articleId({
      ownerId: owner,
      feedId: Option.some(feed),
      url: Option.some(url),
      title: decodeTitle('Title'),
      description: decodeDescription(undefined),
    })
  ).not.toBe(
    articleId({
      ownerId: owner,
      feedId: Option.none(),
      url: Option.some(url),
      title: decodeTitle('Title'),
      description: decodeDescription(undefined),
    })
  );
  expect(
    articleId({
      ownerId: owner,
      feedId: Option.some(feed),
      url: Option.some(url),
      title: decodeTitle('Title'),
      description: decodeDescription(undefined),
    })
  ).not.toBe(
    articleId({
      ownerId: owner,
      feedId: Option.some(otherFeed),
      url: Option.some(url),
      title: decodeTitle('Title'),
      description: decodeDescription(undefined),
    })
  );
});

it('distinguishes linkless feed articles by title', () => {
  const feed = feedId(owner, normalizeUrl('https://example.com/feed'));
  expect(
    articleId({
      ownerId: owner,
      feedId: Option.some(feed),
      url: Option.none(),
      title: decodeTitle('One'),
      description: decodeDescription(undefined),
    })
  ).not.toBe(
    articleId({
      ownerId: owner,
      feedId: Option.some(feed),
      url: Option.none(),
      title: decodeTitle('Two'),
      description: decodeDescription(undefined),
    })
  );
});

it('encodes absent descriptions as omitted fields and present descriptions as strings', () => {
  const schema = Schema.Struct({ description: ArticleDescription });
  const decode = Schema.decodeSync(schema);
  const encode = Schema.encodeSync(schema);
  expect(decode({})).toEqual({ description: Option.none() });
  expect(encode(decode({ description: '  ' }))).toEqual({});
  expect(encode(decode({ description: '  Summary  ' }))).toEqual({
    description: 'Summary',
  });
});

it('normalizes both article content fields and preserves their encoding', () => {
  const schema = Article.mapFields((fields) => ({
    content: fields.content,
    extractedContent: fields.extractedContent,
  }));
  const decode = Schema.decodeSync(schema);
  const encode = Schema.encodeSync(schema);
  expect(Schema.decodeSync(ArticleContent)('  ')).toEqual(Option.none());
  expect(decode({})).toEqual({
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
