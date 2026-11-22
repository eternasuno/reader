import { describe, expect, it } from 'vitest';
import * as state from '../src/state';

describe('library route parsing: fixed scopes', () => {
  it('parses the saved-page and all-feeds routes', () => {
    expect(state.parseLibraryLocation('/later', '')).toEqual({
      scope: { kind: 'later' },
      articleId: null,
      unreadOnly: false,
    });
    expect(state.parseLibraryLocation('/later/p1', '?unread')).toEqual({
      scope: { kind: 'later' },
      articleId: 'p1',
      unreadOnly: true,
    });
    expect(state.parseLibraryLocation('/all/i1/', '')).toEqual({
      scope: { kind: 'all' },
      articleId: 'i1',
      unreadOnly: false,
    });
  });
});

describe('library route parsing: id scopes', () => {
  it('parses feed and folder routes with encoded ids', () => {
    expect(state.parseLibraryLocation('/feed/f%201', '')).toEqual({
      scope: { kind: 'feed', feedId: 'f 1' },
      articleId: null,
      unreadOnly: false,
    });
    expect(state.parseLibraryLocation('/feed/f1/i1', '?unread')).toEqual({
      scope: { kind: 'feed', feedId: 'f1' },
      articleId: 'i1',
      unreadOnly: true,
    });
    expect(state.parseLibraryLocation('/folder/d1', '')).toEqual({
      scope: { kind: 'folder', folderId: 'd1' },
      articleId: null,
      unreadOnly: false,
    });
    expect(state.parseLibraryLocation('/folder/d1/i1', '')).toEqual({
      scope: { kind: 'folder', folderId: 'd1' },
      articleId: 'i1',
      unreadOnly: false,
    });
  });
});

describe('library route parsing: rejections', () => {
  it('rejects unknown, incomplete and over-long paths', () => {
    expect(state.parseLibraryLocation('/settings', '')).toBeNull();
    expect(state.parseLibraryLocation('/', '')).toBeNull();
    expect(state.parseLibraryLocation('/feed', '')).toBeNull();
    expect(state.parseLibraryLocation('/folder/', '')).toBeNull();
    expect(state.parseLibraryLocation('/later/a/b', '')).toBeNull();
  });
});

describe('next path sanitizing', () => {
  it('only accepts same-origin relative next paths', () => {
    expect(state.sanitizeNextPath('/save?url=https%3A%2F%2Fexample.com')).toBe(
      '/save?url=https%3A%2F%2Fexample.com'
    );
    expect(state.sanitizeNextPath(' /later ')).toBe('/later');
    expect(state.sanitizeNextPath('//evil.example')).toBe('/later');
    expect(state.sanitizeNextPath('https://evil.example')).toBe('/later');
    expect(state.sanitizeNextPath('/\\evil.example')).toBe('/later');
    expect(state.sanitizeNextPath('/later\u0000')).toBe('/later');
    expect(state.sanitizeNextPath('/later\nsettings')).toBe('/later');
    expect(state.sanitizeNextPath('')).toBe('/later');
    expect(state.sanitizeNextPath(null)).toBe('/later');
    expect(state.sanitizeNextPath(undefined)).toBe('/later');
  });
});

describe('html summaries', () => {
  it('flattens sanitized HTML to a single-line summary', () => {
    expect(
      state.htmlToPlainText(
        '<p>Hello <strong>world</strong> &amp; <em>friends</em></p>'
      )
    ).toBe('Hello world & friends');
    expect(state.htmlToPlainText('<div>one\n\n  two&nbsp;three</div>')).toBe(
      'one two three'
    );
    expect(
      state.htmlToPlainText('<script>alert(1)</script><p>keep&#39;me</p>')
    ).toBe("keep'me");
    expect(state.htmlToPlainText(undefined)).toBe('');
    expect(state.htmlToPlainText(null)).toBe('');
    expect(state.htmlToPlainText('')).toBe('');
  });
});

describe('hostnames', () => {
  it('extracts URL hostnames', () => {
    expect(state.hostnameOf('https://www.example.com/path?x=1')).toBe(
      'www.example.com'
    );
    expect(state.hostnameOf('not a url')).toBe('');
  });
});

describe('row thumbnails', () => {
  it('returns the first absolute http(s) image source', () => {
    expect(
      state.firstImageUrl(
        '<p>x</p><img alt="a" src="https://cdn.example/a.jpg?w=1&amp;h=2"><img src="https://cdn.example/b.jpg">'
      )
    ).toBe('https://cdn.example/a.jpg?w=1&h=2');
    expect(state.firstImageUrl("<img src='http://example.com/c.png'>")).toBe(
      'http://example.com/c.png'
    );
  });

  it('ignores missing, relative, and non-http sources', () => {
    expect(state.firstImageUrl(undefined)).toBeNull();
    expect(state.firstImageUrl('<p>no image</p>')).toBeNull();
    expect(state.firstImageUrl('<img src="/relative.png">')).toBeNull();
    expect(
      state.firstImageUrl('<img src="data:image/png;base64,AA">')
    ).toBeNull();
  });
});

describe('site icons', () => {
  it('points at the origin favicon for http(s) URLs only', () => {
    expect(state.siteIconUrl('https://www.example.com:8443/a/b?c')).toBe(
      'https://www.example.com:8443/favicon.ico'
    );
    expect(state.siteIconUrl('ftp://example.com/')).toBeNull();
    expect(state.siteIconUrl('not a url')).toBeNull();
  });
});
