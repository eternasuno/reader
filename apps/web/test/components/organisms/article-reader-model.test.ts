import { describe, expect, it } from 'vitest';
import { readerSourceState } from '../../../src/components/organisms/article-reader-model';

describe('reader source selection', () => {
  it('only offers a switch when both cached and nonempty RSS content exist', () => {
    for (const description of [undefined, '', '  \n ']) {
      expect(readerSourceState(true, description, 'rss')).toEqual({
        canToggle: false,
        extracted: true,
      });
    }

    expect(readerSourceState(false, '<p>RSS</p>', undefined)).toEqual({
      canToggle: false,
      extracted: false,
    });
  });

  it('defaults to cache and respects explicit RSS selection when available', () => {
    for (const mode of [undefined, 'extracted'] as const) {
      expect(readerSourceState(true, '<p>RSS</p>', mode)).toEqual({
        canToggle: true,
        extracted: true,
      });
    }

    expect(readerSourceState(true, '<p>RSS</p>', 'rss')).toEqual({
      canToggle: true,
      extracted: false,
    });
  });
});
