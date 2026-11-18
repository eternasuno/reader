import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/web/api/feed', () => ({
  listFeeds: vi.fn(),
  setFeedOrder: vi.fn(),
  setFeedReaderMode: vi.fn(),
}));
vi.mock('../../../src/web/ui/toast', () => ({ showToast: vi.fn() }));

import { ApiFailure } from '../../../src/web/api/failure';
import { setFeedOrder, setFeedReaderMode } from '../../../src/web/api/feed';
import { feedById, setFeeds } from '../../../src/web/feed/list';
import {
  chooseFeedOrder,
  chooseFeedReaderMode,
} from '../../../src/web/feed/preference';
import { showToast } from '../../../src/web/ui/toast';
import { feedFixture } from './support';

/** Choosing a feed's preferences (feeds.md Changing a feed's preferences). */

beforeEach(() => {
  vi.clearAllMocks();
  setFeeds([feedFixture('feed-go', 'Go Blog')]);
});

describe('a feed preference', () => {
  it('Scenario: Ordering a feed oldest first — stores and shows it', async () => {
    vi.mocked(setFeedOrder).mockResolvedValue(undefined);

    const done = chooseFeedOrder('feed-go', 'oldest');

    expect(feedById('feed-go')?.order).toBe('oldest');
    await done;
    expect(setFeedOrder).toHaveBeenCalledWith('feed-go', 'oldest');
  });

  it('Scenario: Choosing the default reader mode of a feed', async () => {
    vi.mocked(setFeedReaderMode).mockResolvedValue(undefined);

    await chooseFeedReaderMode('feed-go', 'embedded');

    expect(setFeedReaderMode).toHaveBeenCalledWith('feed-go', 'embedded');
    expect(feedById('feed-go')?.readerMode).toBe('embedded');
  });

  it('Scenario: A failed preference write is undone', async () => {
    vi.mocked(setFeedOrder).mockRejectedValue(
      new ApiFailure('FeedRepositoryError')
    );

    await chooseFeedOrder('feed-go', 'oldest');

    expect(feedById('feed-go')?.order).toBe('newest');
    expect(showToast).toHaveBeenCalledWith(
      '暂时无法访问订阅，请稍后重试',
      'error'
    );
  });
});
