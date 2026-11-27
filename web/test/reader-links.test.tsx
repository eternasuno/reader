import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openInNewTab } from '../src/components/openInNewTab';
import { ReaderArticleHeader } from '../src/components/ReaderArticle';
import * as state from '../src/state';
import { currentToast } from '../src/ui';
import { mount, setupInteractions } from './support/list-helpers';
import { makeItem } from './support/state-fixture';

const SCOPED_URL = 'http://[fe80::1%25eth0]/post';

setupInteractions();

beforeEach(() => {
  state.clearReaderState();
  state.clearLibraryState();
});

afterEach(() => {
  state.clearReaderState();
  state.clearLibraryState();
});

describe('ReaderArticleHeader link fallback', () => {
  it('renders plain spans instead of anchors for unparsable scoped IPv6 URLs', () => {
    const article: state.LibraryArticle = {
      ...makeItem({
        id: 'i1',
        feedId: 'f1',
        title: 'Scoped IPv6 Post',
        url: SCOPED_URL,
      }),
      kind: 'feed',
    };

    const container = mount(() => <ReaderArticleHeader article={article} />);

    expect(container.querySelectorAll('a')).toHaveLength(0);
    const titleSpan = container.querySelector('h1 > span');
    expect(titleSpan).not.toBeNull();
    expect(titleSpan?.textContent).toBe('Scoped IPv6 Post');
    expect(titleSpan?.className).toBe('transition-colors hover:text-primary');
  });

  it('renders title and hostname anchors for browser-parsable URLs', () => {
    const article: state.LibraryArticle = {
      ...makeItem({
        id: 'i2',
        feedId: 'f1',
        title: 'Normal Post',
        url: 'https://example.com/post',
      }),
      kind: 'feed',
    };

    const container = mount(() => <ReaderArticleHeader article={article} />);
    const links = Array.from(container.querySelectorAll('a'));

    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('https://example.com/post');
    expect(links[0]?.textContent).toBe('Normal Post');
    expect(links[1]?.getAttribute('href')).toBe('https://example.com/post');
    expect(links[1]?.textContent).toBe('example.com');
  });
});

describe('openInNewTab', () => {
  it('shows a toast and does not open a window for scoped IPv6 URLs', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    openInNewTab(SCOPED_URL);

    expect(openSpy).not.toHaveBeenCalled();
    expect(currentToast()).toMatchObject({
      message: '无法在浏览器中打开此链接',
      variant: 'error',
    });
  });

  it('opens browser-parsable URLs in a new tab without a toast', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    openInNewTab('https://example.com/post');

    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/post',
      '_blank',
      'noopener,noreferrer'
    );
    expect(currentToast()).toBeNull();
  });
});
