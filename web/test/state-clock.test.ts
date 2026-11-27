import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountClock, now } from '../src/state/clock';
import { markUnauthenticated } from '../src/state/session';
import { createAppHarness, json } from './support/app-harness';
import { installResizeObserver, sizeScroller } from './support/virtual-helpers';

const minuteStart = Date.UTC(2026, 10, 27, 12, 0);

const setHidden = (hidden: boolean): void => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
  document.dispatchEvent(new Event('visibilitychange'));
  flush();
};

const advance = (ms: number): void => {
  vi.advanceTimersByTime(ms);
  flush();
};

const setupClockTest = (): void => {
  vi.useFakeTimers();
  vi.setSystemTime(minuteStart + 25_000);
  setHidden(false);
};

const teardownClockTest = (): void => {
  markUnauthenticated();
  flush();
  vi.restoreAllMocks();
  vi.useRealTimers();
};

describe('library clock timing', () => {
  beforeEach(setupClockTest);
  afterEach(teardownClockTest);

  it('refreshes on mount and ticks at successive wall-clock minute boundaries', () => {
    mountClock();
    flush();
    expect(now()).toBe(minuteStart + 25_000);

    advance(34_999);
    expect(now()).toBe(minuteStart + 25_000);
    advance(1);
    expect(now()).toBe(minuteStart + 60_000);

    advance(59_999);
    expect(now()).toBe(minuteStart + 60_000);
    advance(1);
    expect(now()).toBe(minuteStart + 120_000);
  });

  it('cancels the timer while hidden and refreshes immediately on becoming visible', () => {
    mountClock();
    flush();
    setHidden(true);

    expect(vi.getTimerCount()).toBe(0);
    advance(120_000);
    expect(now()).toBe(minuteStart + 25_000);

    setHidden(false);
    expect(now()).toBe(minuteStart + 145_000);

    advance(34_999);
    expect(now()).toBe(minuteStart + 145_000);
    advance(1);
    expect(now()).toBe(minuteStart + 180_000);
  });
});

describe('library clock lifecycle', () => {
  beforeEach(setupClockTest);
  afterEach(teardownClockTest);

  it('shares one timer and listener until the last mount releases', () => {
    const addListener = vi.spyOn(document, 'addEventListener');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const releaseFirst = mountClock();
    const releaseLast = mountClock();
    flush();

    const listeners = addListener.mock.calls.filter(
      ([event]) => event === 'visibilitychange'
    );
    expect(listeners).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    releaseFirst();
    releaseFirst();
    advance(35_000);
    expect(now()).toBe(minuteStart + 60_000);
    expect(removeListener).not.toHaveBeenCalledWith(...listeners[0]);

    releaseLast();
    expect(removeListener).toHaveBeenCalledWith(...listeners[0]);
    advance(60_000);
    setHidden(false);
    expect(now()).toBe(minuteStart + 60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up on session clear and allows a fresh mount', () => {
    const releaseOld = mountClock();
    flush();
    markUnauthenticated();
    flush();

    expect(vi.getTimerCount()).toBe(0);
    advance(60_000);
    setHidden(false);
    expect(now()).toBe(minuteStart + 25_000);
    expect(vi.getTimerCount()).toBe(0);

    mountClock();
    releaseOld();
    flush();
    expect(now()).toBe(minuteStart + 85_000);
    advance(35_000);
    expect(now()).toBe(minuteStart + 120_000);
  });
});

describe('library row publish time', () => {
  const harness = createAppHarness();
  harness.installHarnessLifecycle();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('updates an existing row at the minute boundary', async () => {
    setupClockTest();
    const notifyResize = installResizeObserver();
    const id = '019363b8-0000-7000-8000-000000000001';
    const publishedAt = new Date(minuteStart - 180_000).toISOString();
    harness.respond((url) => {
      if (url.startsWith('/api/saved-pages/order?')) {
        return json({ ids: [id], boundary: id });
      }

      if (url === `/api/saved-pages?ids=${id}`) {
        return json({
          items: [
            {
              id,
              url: 'https://example.com/article',
              title: 'Saved article',
              content: '<p>Article content</p>',
              publishedAt,
              read: false,
            },
          ],
        });
      }
    });

    const { container } = harness.mountApp('/later');
    await vi.advanceTimersByTimeAsync(10);
    const scroller = container.querySelector<HTMLDivElement>(
      'div.overflow-y-auto.overscroll-contain'
    );
    if (scroller === null) throw new Error('Missing article scroller');

    sizeScroller(scroller, 400);
    notifyResize(scroller, 400);
    harness.modules.solid.flush();
    const time = scroller.querySelector('time');
    if (time === null) throw new Error('Missing article publish time');

    expect(time.textContent).toBe('3分钟前');

    await vi.advanceTimersByTimeAsync(34_990);
    harness.modules.solid.flush();
    expect(scroller.querySelector('time')).toBe(time);
    expect(time.textContent).toBe('4分钟前');
  });
});
