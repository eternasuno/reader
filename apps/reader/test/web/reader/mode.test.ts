import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../../../src/web/api/failure';
import { extractFeedItem, getFeedItem } from '../../../src/web/api/feed-item';
import { getSavedPage } from '../../../src/web/api/saved-page';
import {
  followRoute,
  isExtracting,
  readerArticle,
  readerMode,
} from '../../../src/web/reader/article';
import { defaultHtml, extractedHtml } from '../../../src/web/reader/content';
import {
  setEmbeddedView,
  toggleExtraction,
} from '../../../src/web/reader/mode';
import { embeddableUrl } from '../../../src/web/reader/webpage';
import { showToast } from '../../../src/web/ui/toast';
import {
  feedItemFixture,
  savedPageArticle,
  savedPageFixture,
} from '../saved-page/fixtures';
import { deferred, freshId, openId, setRows, settle } from './support';

/** The extracted content, the embedded page and what a switch of article does (RD-EXTRACT, RD-MODE, RD-WEBPAGE). */

type ExtractedAnswer = Awaited<ReturnType<typeof extractFeedItem>>;

vi.mock('../../../src/web/library', () => import('./support'));
vi.mock('../../../src/web/api/feed-item', () => ({
  getFeedItem: vi.fn(),
  extractFeedItem: vi.fn(),
}));
vi.mock('../../../src/web/api/saved-page', () => ({ getSavedPage: vi.fn() }));
vi.mock('../../../src/web/ui/toast', () => ({ showToast: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  setRows([]);
});

/** Opens a feed item without extracted content. */
const openFeedItem = async (id: string): Promise<void> => {
  openId(id, 'all');
  vi.mocked(getFeedItem).mockResolvedValue({ item: feedItemFixture(id) });
  followRoute();
  await settle();
};

/** Opens a feed item that already has extracted content. */
const openExtractedFeedItem = async (id: string): Promise<void> => {
  openId(id, 'all');
  vi.mocked(getFeedItem).mockResolvedValue({
    item: feedItemFixture(id, { extractedContent: '<p>提取的正文</p>' }),
  });
  followRoute();
  await settle();
};

/** The HTML the extracted view of the open article shows. */
const shownExtractedHtml = (): string | undefined => {
  const article = readerArticle();

  return article === undefined ? undefined : extractedHtml(article);
};

/** The text the default view of the open article shows. */
const shownDefaultHtml = (): string | undefined => {
  const article = readerArticle();

  return article === undefined ? undefined : defaultHtml(article);
};

describe('the extracted content the article already has', () => {
  it('RD-EXTRACT-3: it is shown at once and sends nothing', async () => {
    await openExtractedFeedItem(freshId());

    await toggleExtraction();

    expect(readerMode()).toBe('extracted');
    expect(extractFeedItem).not.toHaveBeenCalled();
  });

  it('RD-EXTRACT-6: turning extraction off returns to the default content', async () => {
    await openExtractedFeedItem(freshId());
    await toggleExtraction();

    await toggleExtraction();

    expect(readerMode()).toBe('default');
    expect(extractFeedItem).not.toHaveBeenCalled();
  });
});

describe('the first extraction of a feed item', () => {
  it('RD-EXTRACT-4: it spins until the answer, then shows the extracted content', async () => {
    const id = freshId();
    const answer = deferred<ExtractedAnswer>();

    await openFeedItem(id);
    vi.mocked(extractFeedItem).mockReturnValue(answer.promise);

    const pending = toggleExtraction();

    expect(isExtracting()).toBe(true);
    expect(readerMode()).toBe('default');

    void answer.resolve({
      item: feedItemFixture(id, { extractedContent: '<p>提取的正文</p>' }),
    });
    await pending;

    expect(isExtracting()).toBe(false);
    expect(readerMode()).toBe('extracted');
    expect(shownExtractedHtml()).toBe('<p>提取的正文</p>');
  });

  it('RD-EXTRACT-7: a failed extraction keeps the view and shows the toast', async () => {
    await openFeedItem(freshId());
    vi.mocked(extractFeedItem).mockRejectedValue(
      new ApiFailure('ArticleEmptyContent')
    );

    await toggleExtraction();

    expect(readerMode()).toBe('default');
    expect(isExtracting()).toBe(false);
    expect(showToast).toHaveBeenCalledWith('未能提取到文章内容', 'error');
  });
});

describe('an extraction that answers late', () => {
  it('RD-EXTRACT-8: the answer of another article is dropped', async () => {
    const first = freshId();
    const second = freshId();
    const answer = deferred<ExtractedAnswer>();

    await openFeedItem(first);
    vi.mocked(extractFeedItem).mockReturnValue(answer.promise);
    const pending = toggleExtraction();

    await openFeedItem(second);
    void answer.resolve({
      item: feedItemFixture(first, { extractedContent: '<p>第一篇</p>' }),
    });
    await pending;

    expect(readerArticle()?.item.id).toBe(second);
    expect(readerMode()).toBe('default');
  });
});

describe('extracting a saved page', () => {
  it('later.md: a saved page never fetches to extract', async () => {
    const id = freshId();

    openId(id);
    vi.mocked(getSavedPage).mockResolvedValue({
      item: savedPageFixture(id, { content: '<p>正文第一段</p>' }),
    });
    followRoute();
    await settle();

    await toggleExtraction();

    expect(readerMode()).toBe('extracted');
    expect(extractFeedItem).not.toHaveBeenCalled();
    expect(shownExtractedHtml()).toBe('<p>正文第一段</p>');
  });
});

describe('what a switch of article does to the mode', () => {
  it('RD-MODE-1: a different article starts on the default content', async () => {
    const first = freshId();

    await openFeedItem(first);
    vi.mocked(extractFeedItem).mockResolvedValue({
      item: feedItemFixture(first, { extractedContent: '<p>第一篇</p>' }),
    });
    await toggleExtraction();
    expect(readerMode()).toBe('extracted');

    await openFeedItem(freshId());

    expect(readerMode()).toBe('default');
  });

  it('RD-MODE-2: the same article keeps the mode', async () => {
    const id = freshId();

    await openFeedItem(id);
    vi.mocked(extractFeedItem).mockResolvedValue({
      item: feedItemFixture(id, { extractedContent: '<p>提取的正文</p>' }),
    });
    await toggleExtraction();

    followRoute();

    expect(readerMode()).toBe('extracted');
  });
});

describe('the embedded view of an article', () => {
  it('RD-WEBPAGE-1: checking shows the page, unchecking the content', async () => {
    await openFeedItem(freshId());

    setEmbeddedView(true);

    expect(readerMode()).toBe('embedded');

    setEmbeddedView(false);

    expect(readerMode()).toBe('default');
  });

  it('RD-WEBPAGE-5: extraction while the embedded page shows', async () => {
    const id = freshId();

    await openFeedItem(id);
    setEmbeddedView(true);
    vi.mocked(extractFeedItem).mockResolvedValue({
      item: feedItemFixture(id, { extractedContent: '<p>提取的正文</p>' }),
    });

    await toggleExtraction();

    expect(readerMode()).toBe('extracted');
  });
});

describe('the addresses the embedded view may load', () => {
  const appOrigin = 'https://reader.example';

  it('RD-WEBPAGE-4: a foreign page is embedded', () => {
    expect(embeddableUrl('https://example.com/post', appOrigin)).toBe(
      'https://example.com/post'
    );
  });

  it('RD-WEBPAGE-4: the app itself is not embedded', () => {
    expect(embeddableUrl(`${appOrigin}/later`, appOrigin)).toBeUndefined();
  });

  it('RD-WEBPAGE-4: a page with credentials is not embedded', () => {
    expect(
      embeddableUrl('https://user:pass@example.com/post', appOrigin)
    ).toBeUndefined();
  });
});

describe('the default content of an article', () => {
  it('RD-CONTENT-1: a feed item without content shows its description', async () => {
    const id = freshId();

    openId(id, 'all');
    vi.mocked(getFeedItem).mockResolvedValue({
      item: feedItemFixture(id, { description: '<p>摘要</p>' }),
    });
    followRoute();
    await settle();

    expect(shownDefaultHtml()).toBe('<p>摘要</p>');
  });

  it('RD-CONTENT-1: neither content nor description leaves no text', async () => {
    await openFeedItem(freshId());

    expect(shownDefaultHtml()).toBeUndefined();
  });

  it('RD-CONTENT-1: a saved page shows its stored content', () => {
    expect(defaultHtml(savedPageArticle(savedPageFixture('page-1')))).toBe(
      '<p>正文第一段</p>'
    );
  });
});
