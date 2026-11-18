import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractFeedItem, getFeedItem } from '../../../src/web/api/feed-item';
import { getSavedPage } from '../../../src/web/api/saved-page';
import type { Feed } from '../../../src/web/feed';
import {
  followRoute,
  readerArticle,
  readerMode,
} from '../../../src/web/reader/article';
import { setEmbeddedView, startArticle } from '../../../src/web/reader/mode';
import { feedItemFixture, savedPageFixture } from '../saved-page/fixtures';
import { freshId, openId, setRows, settle } from './support';

/** The starting mode of an opened article (RD-MODE-4). */

const known = vi.hoisted(() => ({ feeds: new Map<string, Feed>() }));

vi.mock('../../../src/web/library', () => import('./support'));
vi.mock('../../../src/web/feed', () => ({
  feedById: (id: string) => known.feeds.get(id),
}));
vi.mock('../../../src/web/api/feed-item', () => ({
  getFeedItem: vi.fn(),
  extractFeedItem: vi.fn(),
}));
vi.mock('../../../src/web/api/saved-page', () => ({ getSavedPage: vi.fn() }));
vi.mock('../../../src/web/ui/toast', () => ({ showToast: vi.fn() }));

const storeFeed = (readerMode: Feed['readerMode']): void => {
  known.feeds.set('feed-1', {
    id: 'feed-1',
    ownerId: 'owner-1',
    url: 'https://example.com/feed.xml',
    title: 'Feed',
    readerMode,
    order: 'newest',
  });
};

/** Opens a feed item of `feed-1` and applies its starting mode as the pane does. */
const openFeedItem = async (extractedContent?: string): Promise<void> => {
  const id = freshId();

  openId(id, 'all');
  vi.mocked(getFeedItem).mockResolvedValue({
    item: feedItemFixture(
      id,
      extractedContent === undefined ? {} : { extractedContent }
    ),
  });
  followRoute();
  await settle();
  start();
  await settle();
};

const start = (): void => {
  const article = readerArticle();

  if (article !== undefined) startArticle(article);
};

beforeEach(() => {
  vi.clearAllMocks();
  known.feeds.clear();
  setRows([]);
});

describe('RD-MODE-4 the starting mode', () => {
  it('starts a feed item on the default content for a default feed', async () => {
    storeFeed('default');

    await openFeedItem();

    expect(readerMode()).toBe('default');
  });

  it('starts on the embedded page for an embedded feed', async () => {
    storeFeed('embedded');

    await openFeedItem();

    expect(readerMode()).toBe('embedded');
  });

  it('shows stored extracted content at once for an extracted feed', async () => {
    storeFeed('extracted');

    await openFeedItem('<p>提取的正文</p>');

    expect(readerMode()).toBe('extracted');
    expect(extractFeedItem).not.toHaveBeenCalled();
  });

  it('requests extraction for an extracted feed without it', async () => {
    storeFeed('extracted');
    vi.mocked(extractFeedItem).mockImplementation(async (id) => ({
      item: feedItemFixture(id, { extractedContent: '<p>正文</p>' }),
    }));

    await openFeedItem();

    expect(extractFeedItem).toHaveBeenCalledTimes(1);
    expect(readerMode()).toBe('extracted');
  });

  it('waits for the feed list, then applies the mode once', async () => {
    await openFeedItem();

    expect(readerMode()).toBe('default');

    storeFeed('embedded');
    start();

    expect(readerMode()).toBe('embedded');

    setEmbeddedView(false);
    start();

    expect(readerMode()).toBe('default');
  });

  it('keeps a saved page on the default content', async () => {
    storeFeed('embedded');
    const id = freshId();

    openId(id, 'later');
    vi.mocked(getSavedPage).mockResolvedValue({ item: savedPageFixture(id) });
    followRoute();
    await settle();
    start();

    expect(readerMode()).toBe('default');
  });
});
