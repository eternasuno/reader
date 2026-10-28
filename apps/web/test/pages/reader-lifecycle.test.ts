import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePeriodicReaderRefresh } from '../../src/pages/reader-lifecycle';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('periodic reader list refresh', () => {
  it('refreshes every five minutes, not immediately, and stops on disposal', () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const dispose = createRoot((dispose) => {
      usePeriodicReaderRefresh();

      return dispose;
    });

    try {
      vi.advanceTimersByTime(299_999);
      expect(dispatchEvent).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      expect(dispatchEvent.mock.calls[0]?.[0].type).toBe('reader-data-changed');
      vi.advanceTimersByTime(300_000);
      expect(dispatchEvent).toHaveBeenCalledTimes(2);
    } finally {
      dispose();
    }

    vi.advanceTimersByTime(300_000);
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
  });
});
