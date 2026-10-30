import type { Feed } from '@reader/api';
import { AsyncResult } from 'effect/reactivity';
import { describe, expect, it } from 'vitest';
import {
  adjacentItems,
  isFeedMissing,
} from '../../src/pages/reader-navigation';
import { feed } from '../lib/feed-fixtures';

const items = [{ key: 'first' }, { key: 'middle' }, { key: 'last' }];

describe('loaded-page adjacency', () => {
  it('returns neighbors in loaded order without changing the page', () => {
    expect(adjacentItems(items, 'middle')).toEqual({
      previous: items[0],
      next: items[2],
    });
    expect(items.map((item) => item.key)).toEqual(['first', 'middle', 'last']);
  });

  it('disables navigation at page boundaries', () => {
    expect(adjacentItems(items, 'first')).toEqual({
      previous: undefined,
      next: items[1],
    });
    expect(adjacentItems(items, 'last')).toEqual({
      previous: items[1],
      next: undefined,
    });
    expect(adjacentItems([items[0]!], 'first')).toEqual({
      previous: undefined,
      next: undefined,
    });
  });

  it('does not treat a missing selection as the position before the first item', () => {
    for (const key of [undefined, 'missing']) {
      expect(adjacentItems(items, key)).toEqual({
        previous: undefined,
        next: undefined,
      });
      expect(adjacentItems([], key)).toEqual({
        previous: undefined,
        next: undefined,
      });
    }
  });
});

type FeedList = { readonly items: readonly Feed[] };

const feedsResult = (
  items: readonly Feed[],
  waiting = false
): AsyncResult.AsyncResult<FeedList, unknown> =>
  AsyncResult.success({ items }, { waiting });

const initialResult = (): AsyncResult.AsyncResult<FeedList, unknown> =>
  AsyncResult.initial<FeedList, unknown>();

describe('missing feed guard', () => {
  it('reports only a settled selection that is absent from the feed list', () => {
    expect(isFeedMissing(feedsResult([feed('a')]), 'b')).toBe(true);
    expect(isFeedMissing(feedsResult([feed('a')]), 'a')).toBe(false);
    expect(isFeedMissing(feedsResult([feed('a')]), '')).toBe(false);
  });

  it('ignores feed lists that are still loading or failed', () => {
    expect(isFeedMissing(feedsResult([feed('a')], true), 'b')).toBe(false);
    expect(
      isFeedMissing(AsyncResult.fail<string, FeedList>('offline'), 'b')
    ).toBe(false);
    expect(isFeedMissing(initialResult(), 'b')).toBe(false);
  });
});
