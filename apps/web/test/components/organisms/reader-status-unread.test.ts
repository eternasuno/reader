import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createReadStatusProjection,
  hasUnread,
  READER_READ_STATUS_CHANGED,
  unreadKeys,
} from '../../../src/components/organisms/reader-status';

const items = [
  { key: 'first', read: false },
  { key: 'second', read: true },
  { key: 'third', read: false },
];

const reloaded = [
  { key: 'second', read: true },
  { key: 'third', read: false },
];

const publishRead = (key: string) => {
  window.dispatchEvent(
    new CustomEvent(READER_READ_STATUS_CHANGED, {
      detail: { kind: 'link', key, read: true },
    })
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('unread view membership', () => {
  it('keeps a marked row in place instead of filtering it out', () => {
    vi.stubGlobal('window', new EventTarget());
    const dispose = createRoot((disposeRoot) => {
      const [source] = createSignal(items);
      const projected = createReadStatusProjection('link', source);

      expect(projected()?.map((item) => item.key)).toEqual([
        'first',
        'second',
        'third',
      ]);
      publishRead('first');

      expect(projected()?.map((item) => item.key)).toEqual([
        'first',
        'second',
        'third',
      ]);
      expect(projected()?.map((item) => item.read)).toEqual([
        true,
        true,
        false,
      ]);
      expect(projected()?.[1]).toBe(items[1]);
      expect(source()).toBe(items);
      expect(unreadKeys(projected() ?? [])).toEqual(['third']);
      expect(hasUnread(projected())).toBe(true);
      publishRead('third');
      expect(hasUnread(projected())).toBe(false);

      return disposeRoot;
    });

    dispose();
  });
});

describe('unread view reloads', () => {
  it('drops the row when an authoritative unread reload omits it', () => {
    vi.stubGlobal('window', new EventTarget());
    const dispose = createRoot((disposeRoot) => {
      const [source, setSource] = createSignal(items);
      const projected = createReadStatusProjection('link', source);
      publishRead('first');

      expect(projected()?.[0]?.read).toBe(true);
      setSource(reloaded);

      expect(projected()?.map((item) => item.key)).toEqual(['second', 'third']);
      expect(projected()).toBe(reloaded);

      return disposeRoot;
    });

    dispose();
  });
});
