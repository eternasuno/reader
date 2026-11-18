import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  nextArticle,
  openNeighbour,
  previousArticle,
} from '../../../src/web/reader/nav';
import {
  feedItemArticle,
  feedItemFixture,
  savedPageArticle,
  savedPageFixture,
} from '../saved-page/fixtures';
import { openArticle, openId, setRows } from './support';

/** Previous and next follow the loaded list of the scope (RD-NAV). */

vi.mock('../../../src/web/library', () => import('./support'));

const first = savedPageArticle(savedPageFixture('page-1', { title: 'A' }));
const middle = savedPageArticle(savedPageFixture('page-2', { title: 'B' }));
const last = savedPageArticle(savedPageFixture('page-3', { title: 'C' }));

beforeEach(() => {
  vi.clearAllMocks();
  setRows([first, middle, last]);
});

describe('previous and next', () => {
  it('Scenario: Moving to the next and the previous article', () => {
    openId('page-2');

    expect(nextArticle()).toBe(last);
    expect(previousArticle()).toBe(first);
  });

  it('Scenario: The ends of the list', () => {
    openId('page-1');
    expect(previousArticle()).toBeUndefined();
    expect(nextArticle()).toBe(middle);

    openId('page-3');
    expect(nextArticle()).toBeUndefined();
    expect(previousArticle()).toBe(middle);
  });

  it('RD-NAV-2: an article the list does not hold has no neighbour', () => {
    openId('page-elsewhere');

    expect(previousArticle()).toBeUndefined();
    expect(nextArticle()).toBeUndefined();
  });

  it('RD-NAV-2: an empty list has no neighbour', () => {
    setRows([]);
    openId('page-1');

    expect(previousArticle()).toBeUndefined();
    expect(nextArticle()).toBeUndefined();
  });

  it('RD-NAV-3: a neighbour opens as the list opens it', () => {
    openId('page-2');

    openNeighbour(nextArticle());

    expect(openArticle).toHaveBeenCalledWith('page-3');
  });

  it('RD-NAV-3: a missing neighbour opens nothing', () => {
    openId('page-3');

    openNeighbour(nextArticle());

    expect(openArticle).not.toHaveBeenCalled();
  });

  it('RD-NAV-1: a feed scope moves between feed items', () => {
    setRows([
      feedItemArticle(feedItemFixture('item-1')),
      feedItemArticle(feedItemFixture('item-2')),
    ]);
    openId('item-1', 'all');

    expect(nextArticle()?.item.id).toBe('item-2');
  });
});
