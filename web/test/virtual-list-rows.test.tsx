import { render } from '@solidjs/web';
import { createStore, flush } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VirtualList } from '../src/ui';
import { installResizeObserver, sizeScroller } from './support/virtual-helpers';

interface RowItem {
  id: string;
  read: boolean;
}

interface Rows {
  byId: Record<string, RowItem>;
  ids: Array<string>;
}

const makeRows = (prefix: string, length: number): Rows => {
  const ids = Array.from({ length }, (_, index) => `${prefix}${index}`);
  return {
    byId: Object.fromEntries(ids.map((id) => [id, { id, read: false }])),
    ids,
  };
};

let disposers: Array<() => void> = [];

const mountRows = (
  rows: Rows,
  renderCounts: Map<string, number>
): HTMLDivElement => {
  const notifyResize = installResizeObserver();
  const wrapper = document.createElement('div');
  document.body.append(wrapper);

  disposers.push(
    render(
      () => (
        <VirtualList
          keys={rows.ids}
          estimateSize={100}
          renderItem={(key) => {
            renderCounts.set(key, (renderCounts.get(key) ?? 0) + 1);
            return (
              <div data-row-id={key} data-read={String(rows.byId[key]?.read)}>
                {key}
              </div>
            );
          }}
        />
      ),
      wrapper
    )
  );
  flush();

  const scroller = wrapper.querySelector<HTMLDivElement>('.overflow-y-auto');
  if (scroller === null) throw new Error('missing scroller');
  sizeScroller(scroller, 600);
  notifyResize(scroller, 600);
  flush();
  return scroller;
};

const rowNode = (scroller: HTMLDivElement, id: string): Element | null =>
  scroller.querySelector(`[data-row-id="${id}"]`);

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('VirtualList row identity stability', () => {
  it('updates a field in place without re-rendering any row', () => {
    const [rows, setRows] = createStore(makeRows('a', 5));
    const renderCounts = new Map<string, number>();
    const scroller = mountRows(rows, renderCounts);
    const before = rows.ids.map((id) => rowNode(scroller, id));
    expect(before.every((el) => el !== null)).toBe(true);

    setRows((draft) => {
      draft.byId.a1.read = true;
    });
    flush();

    rows.ids.forEach((id, index) => {
      expect(rowNode(scroller, id)).toBe(before[index]);
      expect(renderCounts.get(id)).toBe(1);
    });
    expect(rowNode(scroller, 'a1')?.getAttribute('data-read')).toBe('true');
  });

  it('keeps row DOM per key when a key is prepended or appended', () => {
    const [rows, setRows] = createStore(makeRows('k', 3));
    const renderCounts = new Map<string, number>();
    const scroller = mountRows(rows, renderCounts);
    const before = rows.ids.map((id) => rowNode(scroller, id));

    setRows((draft) => {
      draft.byId.k9 = { id: 'k9', read: false };
      draft.byId.k8 = { id: 'k8', read: false };
      draft.ids.unshift('k9');
      draft.ids.push('k8');
    });
    flush();

    ['k0', 'k1', 'k2'].forEach((id, index) => {
      expect(rowNode(scroller, id)).toBe(before[index]);
      expect(renderCounts.get(id)).toBe(1);
      expect(rowNode(scroller, id)?.parentElement?.dataset.index).toBe(
        String(index + 1)
      );
    });
    expect(rowNode(scroller, 'k9')?.parentElement?.dataset.index).toBe('0');
    expect(rowNode(scroller, 'k8')?.parentElement?.dataset.index).toBe('4');
  });
});

describe('VirtualList row shrinking guard', () => {
  it('drops trailing rows cleanly when keys shrink', () => {
    const [rows, setRows] = createStore(makeRows('b', 5));
    const renderCounts = new Map<string, number>();
    const scroller = mountRows(rows, renderCounts);

    const firstRow = rowNode(scroller, 'b0');
    expect(scroller.querySelectorAll('[data-index]')).toHaveLength(5);

    setRows((draft) => {
      draft.ids.length = 2;
    });
    flush();

    expect(scroller.querySelectorAll('[data-index]')).toHaveLength(2);
    expect(firstRow?.isConnected).toBe(true);
    expect(rowNode(scroller, 'b0')).toBe(firstRow);
    expect(renderCounts.get('b0')).toBe(1);
    expect(renderCounts.get('b1')).toBe(1);
  });
});
