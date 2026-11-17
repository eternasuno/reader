import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../../../src/web/api/failure';
import { getFeedItem } from '../../../src/web/api/feed-item';
import { getSavedPage } from '../../../src/web/api/saved-page';
import {
  followRoute,
  readerArticle,
  toggleArticleRead,
} from '../../../src/web/reader/article';
import { showToast } from '../../../src/web/ui/toast';
import {
  feedItemArticle,
  feedItemFixture,
  savedPageArticle,
  savedPageFixture,
} from '../saved-page/fixtures';
import {
  deferred,
  freshId,
  openId,
  replaceRow,
  setArticleRead,
  setRows,
  settle,
} from './support';

/** Which article the reader shows and how it is read (RD-ARTICLE, RD-READ). */

type PageAnswer = Awaited<ReturnType<typeof getSavedPage>>;

vi.mock('../../../src/web/library', () => import('./support'));
vi.mock('../../../src/web/api/feed-item', () => ({ getFeedItem: vi.fn() }));
vi.mock('../../../src/web/api/saved-page', () => ({ getSavedPage: vi.fn() }));
vi.mock('../../../src/web/ui/toast', () => ({ showToast: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  setRows([]);
  setArticleRead.mockResolvedValue(true);
});

describe('the article the URL names', () => {
  it('RD-EMPTY-1: a route without an article leaves the reader empty', () => {
    openId(undefined);

    followRoute();

    expect(readerArticle()).toBeUndefined();
  });

  it('RD-ARTICLE-2: a loaded row shows at once and the fetched article replaces it', async () => {
    const id = freshId();
    const answer = deferred<PageAnswer>();

    setRows([savedPageArticle(savedPageFixture(id))]);
    openId(id);
    vi.mocked(getSavedPage).mockReturnValue(answer.promise);

    followRoute();

    expect(readerArticle()?.item.title).toBe('怎样阅读');

    void answer.resolve({
      item: savedPageFixture(id, { title: '取回的文章' }),
    });
    await settle();

    expect(readerArticle()?.item.title).toBe('取回的文章');
    expect(replaceRow).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'saved-page' })
    );
  });

  it('RD-ARTICLE-2: an article outside the loaded list lives in the reader alone', async () => {
    const id = freshId();

    openId(id);
    vi.mocked(getSavedPage).mockResolvedValue({
      item: savedPageFixture(id, { title: '列表之外' }),
    });

    expect(readerArticle()).toBeUndefined();

    followRoute();
    await settle();

    expect(readerArticle()?.item.title).toBe('列表之外');
  });
});

describe('the kind of article a scope opens', () => {
  it('RD-ARTICLE-1: a feed scope fetches a feed item', async () => {
    const id = freshId();

    openId(id, 'all');
    vi.mocked(getFeedItem).mockResolvedValue({ item: feedItemFixture(id) });
    setRows([feedItemArticle(feedItemFixture(id))]);

    followRoute();
    await settle();

    expect(getFeedItem).toHaveBeenCalledWith(id);
    expect(getSavedPage).not.toHaveBeenCalled();
    expect(readerArticle()?.kind).toBe('feed-item');
  });
});

describe('a fetch that answers with nothing to show', () => {
  it('RD-ARTICLE-3: no item leaves the reader empty', async () => {
    const id = freshId();

    setRows([savedPageArticle(savedPageFixture(id))]);
    openId(id);
    vi.mocked(getSavedPage).mockResolvedValue({ item: null });

    followRoute();
    await settle();

    expect(readerArticle()).toBeUndefined();
    expect(replaceRow).not.toHaveBeenCalled();
  });

  it('RD-ARTICLE-4: a failure keeps the row and shows the error toast', async () => {
    const id = freshId();
    const row = savedPageArticle(savedPageFixture(id));

    setRows([row]);
    openId(id);
    vi.mocked(getSavedPage).mockRejectedValue(
      new ApiFailure('SavedPageRepositoryError')
    );

    followRoute();
    await settle();

    expect(showToast).toHaveBeenCalledWith(
      '暂时无法访问稍后阅读，请稍后重试',
      'error'
    );
    expect(readerArticle()).toBe(row);
  });
});

describe('only the newest navigation counts', () => {
  it('RD-ARTICLE-5: a late answer of the previous article changes nothing', async () => {
    const first = freshId();
    const second = freshId();
    const answer = deferred<PageAnswer>();

    openId(first);
    vi.mocked(getSavedPage).mockReturnValueOnce(answer.promise);
    followRoute();

    openId(second);
    vi.mocked(getSavedPage).mockResolvedValue({
      item: savedPageFixture(second, { title: '第二篇' }),
    });
    followRoute();
    await settle();

    void answer.resolve({ item: savedPageFixture(first, { title: '第一篇' }) });
    await settle();

    expect(readerArticle()?.item.title).toBe('第二篇');
  });
});

describe('opening an article and its read state', () => {
  it('RD-READ-1: opening an unread article marks it read', async () => {
    const id = freshId();

    openId(id);
    vi.mocked(getSavedPage).mockResolvedValue({ item: savedPageFixture(id) });

    followRoute();
    await settle();

    expect(setArticleRead).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'saved-page' }),
      true
    );
  });

  it('RD-READ-1: opening an article that is read writes nothing', async () => {
    const id = freshId();

    openId(id);
    vi.mocked(getSavedPage).mockResolvedValue({
      item: savedPageFixture(id, { read: true }),
    });

    followRoute();
    await settle();

    expect(setArticleRead).not.toHaveBeenCalled();
  });
});

describe('the read toggle of the open article', () => {
  it('RD-READ-2: it writes the opposite of the shown state', async () => {
    const id = freshId();

    openId(id);
    vi.mocked(getSavedPage).mockResolvedValue({
      item: savedPageFixture(id, { read: true }),
    });
    followRoute();
    await settle();

    await toggleArticleRead();

    expect(setArticleRead).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'saved-page' }),
      false
    );
  });

  it('RD-READ-1: the mark shows at once, before the write answers', async () => {
    const id = freshId();
    const answer = deferred<boolean>();

    openId(id);
    vi.mocked(getSavedPage).mockResolvedValue({
      item: savedPageFixture(id, { read: true }),
    });
    followRoute();
    await settle();
    setArticleRead.mockReturnValue(answer.promise);

    const pending = toggleArticleRead();

    expect(readerArticle()?.item.read).toBe(false);

    void answer.resolve(true);
    await pending;

    expect(readerArticle()?.item.read).toBe(false);
  });
});

describe('the read write of an article the list does not hold', () => {
  it('RD-READ-3: a failed mark of the opened article rolls its copy back', async () => {
    const id = freshId();

    openId(id);
    vi.mocked(getSavedPage).mockResolvedValue({ item: savedPageFixture(id) });
    setArticleRead.mockResolvedValue(false);

    followRoute();
    await settle();

    expect(readerArticle()?.item.read).toBe(false);

    await toggleArticleRead();

    expect(readerArticle()?.item.read).toBe(false);
  });

  it('RD-READ-3: a written mark leaves the copy as written', async () => {
    const id = freshId();

    openId(id);
    vi.mocked(getSavedPage).mockResolvedValue({
      item: savedPageFixture(id, { read: true }),
    });

    followRoute();
    await settle();
    await toggleArticleRead();

    expect(readerArticle()?.item.read).toBe(false);
    await toggleArticleRead();

    expect(readerArticle()?.item.read).toBe(true);
  });

  it('RD-ARTICLE-5: a mark that settles later does not touch the next article', async () => {
    const first = freshId();
    const second = freshId();
    const answer = deferred<boolean>();

    openId(first);
    vi.mocked(getSavedPage).mockResolvedValue({
      item: savedPageFixture(first),
    });
    setArticleRead.mockReturnValueOnce(answer.promise);
    followRoute();
    await settle();

    openId(second);
    vi.mocked(getSavedPage).mockResolvedValue({
      item: savedPageFixture(second, { title: '第二篇', read: true }),
    });
    followRoute();
    await settle();

    void answer.resolve(false);
    await settle();

    expect(readerArticle()?.item.id).toBe(second);
    expect(readerArticle()?.item.read).toBe(true);
  });
});
