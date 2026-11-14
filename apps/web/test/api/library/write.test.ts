import { describe, expect, it } from 'vitest';
import {
  feedId,
  json,
  makeClient,
  type Recorded,
  uuid,
} from '../../support/api';

const savedA = uuid('11');
const savedB = uuid('12');
const itemA = uuid('13');
const itemB = uuid('14');

const body = (request: Recorded): unknown =>
  JSON.parse(String(request.init?.body));

describe('marking loaded articles', () => {
  it('sends the saved-page ids and the feed-item ids in one request each', async () => {
    const { client, requests } = makeClient(json({ ok: true }));

    await client.markArticles([
      { id: savedA, feedId: undefined },
      { id: itemA, feedId },
      { id: savedB, feedId: undefined },
      { id: itemB, feedId },
    ]);

    expect(requests.map((request) => request.path)).toEqual([
      '/api/library/saved-pages/mark-read',
      '/api/library/feeds/items/mark-read',
    ]);
    expect(requests.map((request) => request.init?.method)).toEqual([
      'POST',
      'POST',
    ]);
    expect(requests.map((request) => body(request))).toEqual([
      { ids: [savedA, savedB] },
      { ids: [itemA, itemB] },
    ]);
  });

  it('sends no request for an empty side', async () => {
    const saved = makeClient(json({ ok: true }));
    await saved.client.markArticles([{ id: savedA, feedId: undefined }]);

    expect(saved.requests.map((request) => request.path)).toEqual([
      '/api/library/saved-pages/mark-read',
    ]);
    expect(saved.requests.map((request) => body(request))).toEqual([
      { ids: [savedA] },
    ]);

    const feeds = makeClient(json({ ok: true }));
    await feeds.client.markArticles([{ id: itemA, feedId }]);

    expect(feeds.requests.map((request) => request.path)).toEqual([
      '/api/library/feeds/items/mark-read',
    ]);
    expect(feeds.requests.map((request) => body(request))).toEqual([
      { ids: [itemA] },
    ]);
  });
});
