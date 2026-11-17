import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removePage } from '../../../src/web/reader/delete';
import { removeSavedPage } from '../../../src/web/saved-page';
import { savedPageFixture } from '../saved-page/fixtures';
import { closeArticle, deferred, openId } from './support';

/** Removing the open saved page (RD-DELETE-2, RD-DELETE-3, RD-ARTICLE-5). */

vi.mock('../../../src/web/library', () => import('./support'));
vi.mock('../../../src/web/saved-page', () => ({ removeSavedPage: vi.fn() }));

const page = savedPageFixture('page-1');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(removeSavedPage).mockResolvedValue(true);
});

describe('the removal of the open page', () => {
  it('RD-DELETE-2: it returns to the list of the scope once the removal succeeded', async () => {
    openId('page-1');

    await removePage(page);

    expect(closeArticle).toHaveBeenCalled();
  });

  it('RD-DELETE-3: a failed removal keeps the page open', async () => {
    vi.mocked(removeSavedPage).mockResolvedValueOnce(false);
    openId('page-1');

    await removePage(page);

    expect(closeArticle).not.toHaveBeenCalled();
  });

  it('RD-ARTICLE-5: a removal that settles after another article opened keeps it open', async () => {
    const answer = deferred<boolean>();

    vi.mocked(removeSavedPage).mockReturnValueOnce(answer.promise);
    openId('page-1');

    const pending = removePage(page);

    openId('page-2');
    void answer.resolve(true);
    await pending;

    expect(closeArticle).not.toHaveBeenCalled();
  });
});
