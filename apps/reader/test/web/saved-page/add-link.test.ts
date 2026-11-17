import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../../../src/web/api/failure';
import {
  addSavedPage,
  getSavedPageUnreadCount,
  lookupSavedPage,
} from '../../../src/web/api/saved-page';
import { prependRow } from '../../../src/web/library';
import {
  addLink,
  addLinkOpen,
  closeAddLink,
  openAddLink,
} from '../../../src/web/saved-page/add-link';
import { savedPageUnreadCount } from '../../../src/web/saved-page/count';
import { showToast } from '../../../src/web/ui/toast';
import { savedPageFixture } from './fixtures';

/** Adding a link to `稍后阅读` (later.md: Adding a link). */

vi.mock('../../../src/web/api/saved-page', () => ({
  addSavedPage: vi.fn(),
  lookupSavedPage: vi.fn(),
  getSavedPageUnreadCount: vi.fn(),
}));
vi.mock('../../../src/web/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../../src/web/library', () => ({ prependRow: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  closeAddLink();
  vi.mocked(getSavedPageUnreadCount).mockResolvedValue({ count: 1 });
});

describe('a link whose page is saved', () => {
  it('Scenario: Adding a link from the 稍后阅读 scope menu', async () => {
    vi.mocked(addSavedPage).mockResolvedValue({
      item: savedPageFixture('page-1'),
    });
    const open = vi.fn();
    openAddLink();

    await addLink('https://example.com/post', open);

    expect(addSavedPage).toHaveBeenCalledWith('https://example.com/post');
    expect(addLinkOpen()).toBe(false);
    expect(showToast).toHaveBeenCalledWith('文章已添加');
    expect(savedPageUnreadCount()).toBe(1);
    expect(open).toHaveBeenCalledWith('page-1');
  });

  it('later.md Adding a link: the new page goes to the top of the later list', async () => {
    const item = savedPageFixture('page-1');
    vi.mocked(addSavedPage).mockResolvedValue({ item });
    openAddLink();

    await addLink('https://example.com/post', vi.fn());

    expect(prependRow).toHaveBeenCalledWith(
      { kind: 'later' },
      { kind: 'saved-page', item }
    );
  });

  it('SP-ADD-1: a link that is already saved opens the page with that URL', async () => {
    vi.mocked(addSavedPage).mockRejectedValue(
      new ApiFailure('SavedPageAlreadyExists', {
        url: 'https://example.com/post',
      })
    );
    vi.mocked(lookupSavedPage).mockResolvedValue({
      item: savedPageFixture('page-2'),
    });
    const open = vi.fn();
    openAddLink();

    await addLink('https://example.com/post?utm_campaign=x', open);

    expect(lookupSavedPage).toHaveBeenCalledWith('https://example.com/post');
    expect(open).toHaveBeenCalledWith('page-2');
    expect(showToast).not.toHaveBeenCalled();
    expect(prependRow).not.toHaveBeenCalled();
    expect(addLinkOpen()).toBe(false);
  });
});

describe('a duplicate that cannot be opened', () => {
  beforeEach(() => {
    vi.mocked(addSavedPage).mockRejectedValue(
      new ApiFailure('SavedPageAlreadyExists', {
        url: 'https://example.com/post',
      })
    );
  });

  it('Scenario: the lookup of the page finds nothing', async () => {
    vi.mocked(lookupSavedPage).mockResolvedValue({ item: null });
    const open = vi.fn();
    openAddLink();

    await addLink('https://example.com/post', open);

    expect(showToast).toHaveBeenCalledWith('该文章已在稍后阅读中', 'error');
    expect(open).not.toHaveBeenCalled();
    expect(addLinkOpen()).toBe(true);
  });

  it('Scenario: Adding a link that is already saved fails to be looked up', async () => {
    vi.mocked(lookupSavedPage).mockRejectedValue(
      new ApiFailure('SavedPageRepositoryError')
    );
    const open = vi.fn();
    openAddLink();

    await addLink('https://example.com/post', open);

    expect(showToast).toHaveBeenCalledWith(
      '暂时无法访问稍后阅读，请稍后重试',
      'error'
    );
    expect(open).not.toHaveBeenCalled();
    expect(addLinkOpen()).toBe(true);
  });
});

describe('a link that cannot be saved', () => {
  it('Scenario: Adding a link that is not a usable address', async () => {
    vi.mocked(addSavedPage).mockRejectedValue(new ApiFailure('InvalidPageUrl'));
    const open = vi.fn();
    openAddLink();

    await addLink('ftp://example.com/post', open);

    expect(showToast).toHaveBeenCalledWith(
      '请输入有效的 http 或 https 链接',
      'error'
    );
    expect(open).not.toHaveBeenCalled();
    expect(addLinkOpen()).toBe(true);
  });

  it('SP-ADD-3: a page that cannot be extracted saves nothing', async () => {
    vi.mocked(addSavedPage).mockRejectedValue(
      new ApiFailure('ArticleEmptyContent')
    );
    const open = vi.fn();
    openAddLink();

    await addLink('https://example.com/empty', open);

    expect(showToast).toHaveBeenCalledWith('未能提取到文章内容', 'error');
    expect(open).not.toHaveBeenCalled();
    expect(addLinkOpen()).toBe(true);
  });
});
