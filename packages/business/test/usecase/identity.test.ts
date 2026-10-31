import { expect, it } from '@effect/vitest';
import { OwnerId } from '../../src/entity/model';
import { articleId, feedId, normalizeUrl } from '../../src/usecase/identity';

const owner = OwnerId.make('alice');
const otherOwner = OwnerId.make('bob');

it('rejects malformed, non-HTTP(S), and credentialed URLs', () => {
  expect(() => normalizeUrl('not a url')).toThrow(TypeError);
  expect(() => normalizeUrl('ftp://example.com/feed')).toThrow(TypeError);
  expect(() => normalizeUrl('javascript:alert(1)')).toThrow(TypeError);
  expect(() => normalizeUrl('https://user@example.com/feed')).toThrow(
    TypeError
  );
  expect(() => normalizeUrl('https://user:secret@example.com/feed')).toThrow(
    TypeError
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

it('derives a stable feed identity from the owner and normalized URL', () => {
  const normalized = normalizeUrl('https://example.com/feed');
  const equivalent = new URL('https://Example.com:443/feed?utm_source=x');
  expect(feedId(owner, equivalent)).toBe(feedId(owner, normalized));
  expect(feedId(owner, normalized)).not.toBe(feedId(otherOwner, normalized));
  expect(feedId(owner, normalized)).not.toBe(
    feedId(owner, normalizeUrl('https://example.com/other'))
  );
});

it('derives article identity from normalized URL, trimmed text, and owner', () => {
  const url = new URL('https://Example.com:443/post?UTM_Source=x');
  expect(articleId(owner, undefined, url, 'Title', 'Description')).toBe(
    articleId(
      owner,
      undefined,
      normalizeUrl('https://example.com/post'),
      'Title',
      'Description'
    )
  );
  expect(
    articleId(owner, undefined, undefined, 'New  Post', undefined)
  ).not.toBe(articleId(owner, undefined, undefined, 'new post', undefined));
  expect(articleId(owner, undefined, undefined, 'Title', undefined)).not.toBe(
    articleId(otherOwner, undefined, undefined, 'Title', undefined)
  );
  expect(articleId(owner, undefined, undefined, 'Title', undefined)).not.toBe(
    articleId(
      owner,
      undefined,
      normalizeUrl('https://example.com/a'),
      'Title',
      undefined
    )
  );
});

it('normalizes empty titles and descriptions while preserving inner text', () => {
  expect(articleId(owner, undefined, undefined, '  ', '  ')).toBe(
    articleId(owner, undefined, undefined, 'Untitled', '')
  );
  expect(
    articleId(owner, undefined, undefined, '  Title  ', '  Description  ')
  ).toBe(articleId(owner, undefined, undefined, 'Title', 'Description'));
  expect(articleId(owner, undefined, undefined, 'Title', undefined)).toBe(
    articleId(owner, undefined, undefined, 'Title', '')
  );
});

it('uses the feed identity for feed articles and the owner otherwise', () => {
  const feed = feedId(owner, normalizeUrl('https://example.com/feed'));
  const otherFeed = feedId(owner, normalizeUrl('https://example.com/other'));
  const url = normalizeUrl('https://example.com/post');
  expect(articleId(owner, feed, url, 'Title', undefined)).not.toBe(
    articleId(owner, undefined, url, 'Title', undefined)
  );
  expect(articleId(owner, feed, url, 'Title', undefined)).not.toBe(
    articleId(owner, otherFeed, url, 'Title', undefined)
  );
  expect(articleId(owner, feed, undefined, 'One', undefined)).not.toBe(
    articleId(owner, feed, undefined, 'Two', undefined)
  );
});
