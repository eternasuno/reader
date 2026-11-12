import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { NormalizedUrl } from '../../../src/entity/common/normalized-url';

const decode = Schema.decodeUnknownResult(NormalizedUrl);

const encode = Schema.encodeSync(NormalizedUrl);

const isInvalid = (input: string): boolean => Result.isFailure(decode(input));

const hrefOf = (input: string): string => Result.getOrThrow(decode(input)).href;

const trackingNames = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_anything',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'li_fat_id',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  '_ga',
  '_gl',
];

describe('NormalizedUrl rules', () => {
  it('accepts only http and https urls', () => {
    expect(hrefOf('https://example.com/post')).toBe('https://example.com/post');
    expect(hrefOf('http://example.com/post')).toBe('http://example.com/post');

    for (const input of [
      'ftp://example.com/post',
      'file:///tmp/post',
      'mailto:someone@example.com',
      'ws://example.com/socket',
      'not a url',
      '/relative/path',
    ]) {
      expect(isInvalid(input)).toBe(true);
    }
  });

  it('removes every tracking parameter, matching names case-insensitively', () => {
    const query = trackingNames.map((name) => `${name}=1`).join('&');

    expect(hrefOf(`https://example.com/post?${query}`)).toBe(
      'https://example.com/post'
    );
    expect(
      hrefOf(`https://example.com/post?UTM_Source=a&FbClId=b&utm_ref=c&_GA=d`)
    ).toBe('https://example.com/post');
  });

  it('keeps generic query parameters that do not name a tracker', () => {
    const href = hrefOf(
      'https://example.com/post?ref=home&source=mail&from=feed&si=42&utm_medium=x'
    );

    expect(href).toBe(
      'https://example.com/post?ref=home&source=mail&from=feed&si=42'
    );
  });

  it('always removes the fragment', () => {
    expect(hrefOf('https://example.com/post#section-2')).toBe(
      'https://example.com/post'
    );
    expect(hrefOf('https://example.com/post?a=1#/route/1')).toBe(
      'https://example.com/post?a=1'
    );
  });
});

describe('NormalizedUrl serialization', () => {
  it('keeps credentials as given', () => {
    const url = Result.getOrThrow(decode('https://user:secret@example.com/a'));

    expect(url.username).toBe('user');
    expect(url.password).toBe('secret');
    expect(url.href).toBe('https://user:secret@example.com/a');
  });

  it('applies the standard url serialization', () => {
    expect(hrefOf('https://EXAMPLE.com')).toBe('https://example.com/');
    expect(hrefOf('https://example.com:443/post')).toBe(
      'https://example.com/post'
    );
    expect(hrefOf('https://example.com/post/')).toBe(
      'https://example.com/post/'
    );
    expect(hrefOf('https://site')).toBe(hrefOf('https://site/'));
    expect(hrefOf('https://site/post')).not.toBe(hrefOf('https://site/post/'));
    expect(hrefOf('http://site/post')).not.toBe(hrefOf('https://site/post'));
    expect(hrefOf('https://site/post')).not.toBe(
      hrefOf('https://www.site/post')
    );
  });

  it('encodes back to the url string', () => {
    const url = Result.getOrThrow(decode('https://example.com/a?b=1#frag'));

    expect(encode(url)).toBe('https://example.com/a?b=1');
  });
});
