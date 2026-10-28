import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readerSourceState,
  useReaderNotices,
} from '../../../src/components/organisms/article-reader-model';
import { READER_READ_STATUS_CHANGED } from '../../../src/components/organisms/reader-status';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reader source selection', () => {
  it('only offers a switch when both cached and nonempty RSS content exist', () => {
    for (const description of [undefined, '', '  \n ']) {
      expect(readerSourceState(true, description, 'rss')).toEqual({
        canToggle: false,
        extracted: true,
      });
    }

    expect(readerSourceState(false, '<p>RSS</p>', undefined)).toEqual({
      canToggle: false,
      extracted: false,
    });
  });

  it('defaults to cache and respects explicit RSS selection when available', () => {
    for (const mode of [undefined, 'extracted'] as const) {
      expect(readerSourceState(true, '<p>RSS</p>', mode)).toEqual({
        canToggle: true,
        extracted: true,
      });
    }

    expect(readerSourceState(true, '<p>RSS</p>', 'rss')).toEqual({
      canToggle: true,
      extracted: false,
    });
  });
});

describe('reader read status notices', () => {
  it('follows matching status events for the open article', () => {
    vi.stubGlobal('window', new EventTarget());
    const selection = {
      kind: 'link' as const,
      key: 'article',
      title: '',
      url: '',
      read: false,
    };
    const dispose = createRoot((disposeRoot) => {
      const notices = useReaderNotices(selection);
      const publish = (kind: 'link' | 'feed', key: string, read: boolean) =>
        window.dispatchEvent(
          new CustomEvent(READER_READ_STATUS_CHANGED, {
            detail: { kind, key, read },
          })
        );

      publish('feed', 'article', true);
      expect(notices.read()).toBe(false);
      publish('link', 'other', true);
      expect(notices.read()).toBe(false);
      publish('link', 'article', true);
      expect(notices.read()).toBe(true);
      publish('link', 'article', false);
      expect(notices.read()).toBe(false);

      return disposeRoot;
    });

    dispose();
  });
});
