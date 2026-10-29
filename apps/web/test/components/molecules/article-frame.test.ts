import { describe, expect, it } from 'vitest';
import {
  articleFrameHeight,
  webpageFrameUrl,
} from '../../../src/lib/article-frame';

describe('inline webpage URLs', () => {
  it('embeds only external HTTP(S) pages without credentials', () => {
    const origin = 'https://reader.example.com';
    expect(webpageFrameUrl('https://news.example.com/article', origin)).toBe(
      'https://news.example.com/article'
    );
    expect(webpageFrameUrl('http://news.example.com/article', origin)).toBe(
      'http://news.example.com/article'
    );
    for (const url of [
      'https://reader.example.com/article',
      '/article',
      'javascript:alert(1)',
      'data:text/html,test',
      'https://user:pass@news.example.com/article',
      'invalid',
      '',
    ]) {
      expect(webpageFrameUrl(url, origin)).toBeUndefined();
    }
  });
});

describe('article frame resize messages', () => {
  const source = {};
  const data = { type: 'article-frame-resize', token: 'secret', height: 123.2 };

  it('accepts only the current frame and token, without trusting origin', () => {
    expect(articleFrameHeight({ source, data }, source, 'secret')).toBe(124);
    expect(
      articleFrameHeight({ source: {}, data }, source, 'secret')
    ).toBeUndefined();
    expect(
      articleFrameHeight({ source, data }, source, 'other')
    ).toBeUndefined();
    expect(
      articleFrameHeight({ source: null, data }, null, 'secret')
    ).toBeUndefined();
  });
});

describe('article frame height bounds', () => {
  const source = {};
  const data = { type: 'article-frame-resize', token: 'secret', height: 123.2 };

  it('rejects malformed messages and out-of-range heights', () => {
    for (const height of [
      NaN,
      Infinity,
      -Infinity,
      0,
      -1,
      1_000_001,
      '123',
      null,
      undefined,
    ]) {
      expect(
        articleFrameHeight(
          { source, data: { ...data, height } },
          source,
          'secret'
        )
      ).toBeUndefined();
    }

    for (const message of [
      null,
      [],
      'resize',
      {},
      { ...data, type: 'other' },
    ]) {
      expect(
        articleFrameHeight({ source, data: message }, source, 'secret')
      ).toBeUndefined();
    }

    expect(
      articleFrameHeight(
        { source, data: { ...data, height: 1 } },
        source,
        'secret'
      )
    ).toBe(1);
    expect(
      articleFrameHeight(
        { source, data: { ...data, height: 1_000_000 } },
        source,
        'secret'
      )
    ).toBe(1_000_000);
  });
});
