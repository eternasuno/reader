import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeRunner } from '../../../src/api/client';
import {
  createLibraryClient,
  libraryErrorMessages,
} from '../../../src/api/library';
import {
  failure,
  feedArticle,
  feedId,
  itemId,
  json,
  makeClient,
} from '../../support/api';

describe('error wording', () => {
  it('keeps the saved page url of a duplicate article', async () => {
    const { client } = makeClient(
      json(
        {
          _tag: 'SavedPageAlreadyExists',
          message: 'backend text',
          url: 'https://example.com/post',
        },
        409
      )
    );

    expect(await failure(client.add('https://example.com/post'))).toMatchObject(
      {
        tag: 'SavedPageAlreadyExists',
        url: 'https://example.com/post',
        id: undefined,
        message: '该文章已在稍后阅读中',
      }
    );
  });

  it('keeps the item id of a missing article', async () => {
    const { client } = makeClient(
      json({ _tag: 'FeedItemNotFound', message: 'missing', id: itemId }, 404)
    );

    expect(await failure(client.extract(feedArticle))).toMatchObject({
      tag: 'FeedItemNotFound',
      id: itemId,
      message: '文章不存在，可能已被删除',
    });
  });
});

describe('error fallbacks', () => {
  it('maps a rejected fetch to a network failure', async () => {
    const client = createLibraryClient({
      fetch: () => Promise.reject(new Error('offline')),
    });

    expect(await failure(client.feeds())).toMatchObject({
      tag: 'NetworkError',
      message: '网络连接失败，请检查网络后重试',
    });
  });

  it.each([
    ['Unauthorized', 401],
    ['Forbidden', 403],
    ['AuthUnavailable', 500],
  ] as const)('maps a %s response body', async (tag, status) => {
    const { client } = makeClient(json({ _tag: tag }, status));
    const caught = await failure(client.add('https://example.com/post'));

    expect(caught).toMatchObject({ tag, message: libraryErrorMessages[tag] });
  });

  it('keeps the original defect instead of wrapping it', async () => {
    const run = makeRunner({});
    const boom = new Error('boom');

    expect(await failure(run(() => Effect.die(boom)))).toBe(boom);
  });

  it.each([
    ['RequestFailed', () => new Response('boom', { status: 500 })],
    ['InvalidResponse', json({ items: [{ id: feedId }] })],
  ] as const)('maps an unexpected response to %s', async (tag, handler) => {
    const { client } = makeClient(handler);

    expect(await failure(client.feeds())).toMatchObject({
      tag,
      message: libraryErrorMessages[tag],
    });
  });
});
