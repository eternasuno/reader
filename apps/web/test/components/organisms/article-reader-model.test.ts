import { AsyncResult } from 'effect/reactivity';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readerFeedKey,
  readerSourceState,
  toReaderStatus,
  useReaderNotices,
} from '../../../src/components/organisms/article-reader-model';
import {
  READER_BULK_READ_STATUS_CHANGED,
  READER_READ_STATUS_CHANGED,
} from '../../../src/components/organisms/reader-status';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reader inline status', () => {
  it('leaves missing-key extraction errors to the toast', () => {
    const stores = {
      mutation: () =>
        AsyncResult.fail({ error: '请先在设置中填写 Jina API Key' }),
      content: () => AsyncResult.initial(),
      readingMutation: () => AsyncResult.initial(),
      feedMutation: () => AsyncResult.initial(),
    };
    const status = toReaderStatus(stores, () => '');

    expect(status()).toBe('');
  });
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

describe('scoped bulk notices', () => {
  it('applies link and all-feeds scopes outside loaded keys', () => {
    vi.stubGlobal('window', new EventTarget());
    const dispose = createRoot((disposeRoot) => {
      const link = useReaderNotices({
        kind: 'link',
        key: 'link-article',
        title: '',
        url: '',
        read: false,
      });
      const feed = useReaderNotices({
        kind: 'feed',
        key: 'feed-article',
        title: '',
        url: '',
        read: false,
        feedKey: 'feed-a',
      });
      const publish = (detail: unknown) =>
        window.dispatchEvent(
          new CustomEvent(READER_BULK_READ_STATUS_CHANGED, { detail })
        );

      publish({ kind: 'link', keys: [], read: true, scope: { kind: 'links' } });
      expect(link.read()).toBe(true);
      expect(feed.read()).toBe(false);
      publish({
        kind: 'feed',
        keys: [],
        read: false,
        scope: { kind: 'allfeeds' },
      });
      expect(feed.read()).toBe(false);

      return disposeRoot;
    });

    dispose();
  });
});

describe('single-feed bulk notices', () => {
  it('applies only the matching single-feed scope', () => {
    vi.stubGlobal('window', new EventTarget());
    const dispose = createRoot((disposeRoot) => {
      const feed = useReaderNotices({
        kind: 'feed',
        key: 'feed-article',
        title: '',
        url: '',
        read: false,
        feedKey: 'feed-a',
      });
      const publish = (feedKey: string) =>
        window.dispatchEvent(
          new CustomEvent(READER_BULK_READ_STATUS_CHANGED, {
            detail: {
              kind: 'feed',
              keys: [],
              read: true,
              scope: { kind: 'singlefeed', feedKey },
            },
          })
        );

      publish('feed-b');
      expect(feed.read()).toBe(false);
      publish('feed-a');
      expect(feed.read()).toBe(true);

      return disposeRoot;
    });

    dispose();
  });
});

describe('directly opened feed scope', () => {
  it('resolves the feed key before applying a single-feed scope', () => {
    vi.stubGlobal('window', new EventTarget());
    const dispose = createRoot((disposeRoot) => {
      const [feedKey, setFeedKey] = createSignal<string>();
      const notices = useReaderNotices(
        {
          kind: 'feed',
          key: 'feed-article',
          title: '',
          url: '',
          read: false,
        },
        feedKey
      );

      window.dispatchEvent(
        new CustomEvent(READER_BULK_READ_STATUS_CHANGED, {
          detail: {
            kind: 'feed',
            keys: [],
            read: true,
            scope: { kind: 'singlefeed', feedKey: 'feed-a' },
          },
        })
      );
      expect(notices.read()).toBe(false);
      setFeedKey('feed-a');
      expect(notices.read()).toBe(true);

      return disposeRoot;
    });

    dispose();
  });
});

describe('loaded-key bulk fallback', () => {
  it('matches loaded keys when the feed key is unknown', () => {
    vi.stubGlobal('window', new EventTarget());
    const dispose = createRoot((disposeRoot) => {
      const notices = useReaderNotices({
        kind: 'feed',
        key: 'feed-article',
        title: '',
        url: '',
        read: false,
      });

      window.dispatchEvent(
        new CustomEvent(READER_BULK_READ_STATUS_CHANGED, {
          detail: {
            kind: 'feed',
            keys: ['feed-article'],
            read: true,
            scope: { kind: 'singlefeed', feedKey: 'feed-a' },
          },
        })
      );
      expect(notices.read()).toBe(true);

      return disposeRoot;
    });

    dispose();
  });
});

describe('reader feed key resolution', () => {
  it('prefers the selection feed key and falls back to the loaded source', () => {
    expect(
      readerFeedKey({ feedKey: 'selection-feed' }, { feedKey: 'source-feed' })
    ).toBe('selection-feed');
    expect(readerFeedKey({}, { feedKey: 'source-feed' })).toBe('source-feed');
    expect(readerFeedKey({}, undefined)).toBeUndefined();
  });
});
