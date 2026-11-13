import { describe, expect, it } from 'vitest';
import { LibraryError } from '../../../src/api/library';
import { createLibraryContext } from '../../../src/models/library/context';
import { loadFeeds } from '../../../src/models/library/reference';
import { createStubClient, feed } from '../../support/library';

const feedFailure = {
  kind: 'error',
  message: '暂时无法访问订阅，请稍后重试',
} as const;

describe('library reference loading', () => {
  it('reports failed feed loads and reports a new failure after recovery', async () => {
    const client = createStubClient();
    const store = createLibraryContext(client);
    store.setState((current) => ({ ...current, feeds: [feed('f1')] }));

    client.feeds.mockRejectedValueOnce(new LibraryError('FeedRepositoryError'));
    await loadFeeds(store);

    expect(store.state().feeds.map((item) => item.id)).toEqual(['f1']);
    expect(store.state().toast).toEqual(feedFailure);

    store.setState((current) => ({ ...current, toast: undefined }));
    client.feeds.mockResolvedValueOnce([feed('f1'), feed('f2')]);
    await loadFeeds(store);

    expect(store.state().feeds.map((item) => item.id)).toEqual(['f1', 'f2']);
    expect(store.state().toast).toBeUndefined();

    client.feeds.mockRejectedValueOnce(new LibraryError('FeedRepositoryError'));
    await loadFeeds(store);

    expect(store.state().toast).toEqual(feedFailure);
  });
});
