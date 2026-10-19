import { describe, expect, it } from 'vitest';
import { adjacentItems } from '../../src/pages/reader-navigation';

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
