import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  sendToKindle: vi.fn(),
}));

vi.mock('../../../src/web/api/kindle', () => api);

import { ApiFailure } from '../../../src/web/api/failure';
import { kindleSending, sendNow } from '../../../src/web/setting/kindle/send';
import { settingStore } from '../../../src/web/setting/store';
import { dismissToast, toasts } from '../../../src/web/ui/toast';

/**
 * The send-now button of kindle.md Interface: it sends with the stored delivery,
 * reports the count it answered (KD-SEND-8), keeps its own pending state and
 * never takes the page's one settings write.
 */

const messagesOf = (kind: 'success' | 'error'): ReadonlyArray<string> =>
  toasts()
    .filter((toast) => toast.kind === kind)
    .map((toast) => toast.message);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();

  for (const toast of toasts()) dismissToast(toast.id);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sending now', () => {
  it('KD-SEND-8: a send with articles reports the count', async () => {
    api.sendToKindle.mockResolvedValue({ count: 3 });

    await sendNow();

    expect(messagesOf('success')).toEqual(['已发送 3 篇文章到 Kindle']);
    expect(kindleSending()).toBe(false);
  });

  it('KD-SEND-2: nothing unread reports that instead', async () => {
    api.sendToKindle.mockResolvedValue({ count: 0 });

    await sendNow();

    expect(messagesOf('success')).toEqual(['没有未读文章']);
  });

  it('KD-SEND-1: no delivery saved shows the wording of its tag', async () => {
    api.sendToKindle.mockRejectedValue(new ApiFailure('KindleNotConfigured'));

    await sendNow();

    expect(messagesOf('error')).toEqual(['请先保存 Kindle 发送设置']);
    expect(kindleSending()).toBe(false);
  });

  it('KD-SEND-6: a refused mail shows the wording of its tag', async () => {
    api.sendToKindle.mockRejectedValue(new ApiFailure('MailSenderError'));

    await sendNow();

    expect(messagesOf('error')).toEqual(['邮件发送失败，请检查 SMTP 设置']);
  });

  it('KD-SEND-7: a send already running starts nothing', async () => {
    let finish: (value: { count: number }) => void = () => undefined;
    api.sendToKindle.mockImplementation(
      () =>
        new Promise<{ count: number }>((resolve) => {
          finish = resolve;
        })
    );

    const first = sendNow();
    const second = sendNow();

    expect(api.sendToKindle).toHaveBeenCalledTimes(1);

    finish({ count: 1 });
    await Promise.all([first, second]);

    expect(messagesOf('success')).toEqual(['已发送 1 篇文章到 Kindle']);
  });
});

describe('the pending state of a send', () => {
  it('is its own flag: the page’s one write stays free', async () => {
    let finish: (value: { count: number }) => void = () => undefined;
    api.sendToKindle.mockImplementation(
      () =>
        new Promise<{ count: number }>((resolve) => {
          finish = resolve;
        })
    );

    const sending = sendNow();

    expect(kindleSending()).toBe(true);
    expect(settingStore.saving()).toBeUndefined();

    finish({ count: 2 });
    await sending;

    expect(kindleSending()).toBe(false);
  });
});
