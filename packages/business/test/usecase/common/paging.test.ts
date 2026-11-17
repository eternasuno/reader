import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { pageOf, pageQuery } from '../../../src/usecase/common/paging';

type Row = { readonly id: string };

const rows = (...ids: ReadonlyArray<string>): ReadonlyArray<Row> =>
  ids.map((id) => ({ id }));

describe('pageQuery', () => {
  it('CM-PAGE-4 asks the repository for one row more than the caller asked for', () => {
    expect(
      pageQuery({ unread: false, limit: 30, cursor: Option.none() })
    ).toStrictEqual({
      limit: 31,
      unread: false,
      cursor: Option.none(),
    });
  });

  it('CM-PAGE-3 passes the cursor and the filter through unchanged', () => {
    expect(
      pageQuery({ unread: true, limit: 2, cursor: Option.some('row') })
    ).toStrictEqual({ limit: 3, unread: true, cursor: Option.some('row') });
  });
});

describe('pageOf', () => {
  it('CM-PAGE-4 cuts the extra row off and reports its predecessor as the cursor', () => {
    expect(pageOf(rows('d', 'c', 'b'), 2)).toStrictEqual({
      items: rows('d', 'c'),
      cursor: 'c',
    });
  });

  it('CM-PAGE-4 answers a null cursor when no extra row came back', () => {
    expect(pageOf(rows('b', 'a'), 2)).toStrictEqual({
      items: rows('b', 'a'),
      cursor: null,
    });
  });

  it('CM-PAGE-4 answers an empty page with a null cursor', () => {
    expect(pageOf(rows(), 2)).toStrictEqual({ items: [], cursor: null });
  });
});
