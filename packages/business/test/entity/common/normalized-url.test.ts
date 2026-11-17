import { describe, expect, it } from '@effect/vitest';
import { Result, Schema } from 'effect';
import { NormalizedUrl } from '../../../src/entity/common/normalized-url';

const decode = Schema.decodeUnknownResult(NormalizedUrl);

const hrefOf = (input: string): string => Result.getOrThrow(decode(input)).href;

const isInvalid = (input: string): boolean => Result.isFailure(decode(input));

/** Every name CM-URL-2 removes, including one that only shares the prefix. */
const TRACKING_NAMES = [
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

describe('NormalizedUrl', () => {
  it('CM-URL-1 accepts only the http and https protocols', () => {
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

  it('CM-URL-2 removes every tracking parameter it names', () => {
    const query = TRACKING_NAMES.map((name) => `${name}=1`).join('&');

    expect(hrefOf(`https://example.com/post?${query}`)).toBe(
      'https://example.com/post'
    );
  });

  it('CM-URL-2 matches the parameter names case-insensitively', () => {
    expect(
      hrefOf('https://example.com/post?UTM_Source=a&FbClId=b&_GA=d&utm_ref=e')
    ).toBe('https://example.com/post');
  });

  it('CM-URL-2 keeps generic names that do not name a tracker', () => {
    const href = hrefOf(
      'https://example.com/post?ref=home&source=mail&from=feed&si=42&utm_medium=x'
    );

    expect(href).toBe(
      'https://example.com/post?ref=home&source=mail&from=feed&si=42'
    );
  });

  it('CM-URL-3 removes the fragment whatever it contains', () => {
    expect(hrefOf('https://example.com/post#section-2')).toBe(
      'https://example.com/post'
    );
    expect(hrefOf('https://example.com/post?a=1#/route/1')).toBe(
      'https://example.com/post?a=1'
    );
  });

  it('CM-URL-4 accepts a URL that carries a user name and password and keeps it as given', () => {
    const url = Result.getOrThrow(decode('https://user:secret@example.com/a'));

    expect(url.username).toBe('user');
    expect(url.password).toBe('secret');
    expect(url.href).toBe('https://user:secret@example.com/a');
  });
});

describe('NormalizedUrl serialization', () => {
  it('CM-URL-6 applies the standard serialization: lower-case host and default port removed', () => {
    expect(hrefOf('HTTPS://Site.Example')).toBe('https://site.example/');
    expect(hrefOf('https://site.example:443/')).toBe('https://site.example/');
    expect(hrefOf('http://site.example:80')).toBe('http://site.example/');
  });

  it('CM-URL-6 makes an empty path / and keeps everything else as it is', () => {
    expect(hrefOf('https://site.example')).toBe(
      hrefOf('https://site.example/')
    );

    expect(hrefOf('https://site.example/post')).not.toBe(
      hrefOf('https://site.example/post/')
    );
    expect(hrefOf('http://site.example/')).not.toBe(
      hrefOf('https://site.example/')
    );
    expect(hrefOf('https://www.site.example/')).not.toBe(
      hrefOf('https://site.example/')
    );
  });

  it('CM-URL-6 keeps remaining query components byte for byte when removing trackers', () => {
    expect(
      hrefOf(
        'https://example.com/post?q=a%20b+c&sig=~&tilde=%7E&utm_source=x&fbclid=y'
      )
    ).toBe('https://example.com/post?q=a%20b+c&sig=~&tilde=%7E');
    expect(
      hrefOf('https://example.com/post?a=1&&utm_medium=x&b=2&&gclid=z')
    ).toBe('https://example.com/post?a=1&&b=2&');
    expect(
      hrefOf('https://example.com/post?unread&utm_campaign&flag=1&gclid')
    ).toBe('https://example.com/post?unread&flag=1');
    expect(
      hrefOf('https://example.com/post?%75tm_source=a&utm_bad%ZZ=b&keep%ZZ=1')
    ).toBe('https://example.com/post?keep%ZZ=1');
  });

  it('CM-URL-6 leaves a query without tracking parameters byte-identical', () => {
    const url =
      'https://example.com/post?q=a%20b+c&sig=~&tilde=%7E&&flag&empty=';

    expect(hrefOf(url)).toBe(url);
  });
});
