import { createSignal, flush } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { SubscribeFeedDialog } from '../src/components';
import { Dialog } from '../src/ui';
import {
  element,
  FEED_URL,
  FOLDERS,
  fetchMock,
  jsonResponse,
  mount,
  PREVIEW,
  submitAndSettle,
  typeInto,
} from './support/dialog-helpers';

const pressTab = (shiftKey = false): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);

  return event;
};

describe('Dialog closeLabel, busy state, and focus trap', () => {
  it('renders closeLabel, disables close when busy, and pulls outside Tab focus inside', async () => {
    const outsideBtn = document.createElement('button');
    outsideBtn.textContent = 'Outside';
    document.body.append(outsideBtn);
    outsideBtn.focus();

    const [open, setOpen] = createSignal(true);
    const [busy, setBusy] = createSignal(true);
    const onClose = vi.fn(() => setOpen(false));

    mount(() => (
      <Dialog
        open={open()}
        title="Title"
        closeLabel="关闭弹窗"
        busy={busy()}
        onClose={onClose}
      >
        <button type="button" id="first-inside">
          First
        </button>
        <button type="button" id="last-inside">
          Last
        </button>
      </Dialog>
    ));
    await Promise.resolve();

    const closeBtn = element<HTMLButtonElement>(
      'button[aria-label="关闭弹窗"]'
    );
    expect(closeBtn).not.toBeNull();
    expect(closeBtn.disabled).toBe(true);
    closeBtn.click();
    expect(onClose).not.toHaveBeenCalled();

    setBusy(false);
    flush();
    expect(closeBtn.disabled).toBe(false);

    // Move focus outside the dialog panel and press Tab / Shift+Tab.
    outsideBtn.focus();
    const tabForward = pressTab();
    expect(tabForward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeBtn);

    outsideBtn.focus();
    const tabBackward = pressTab(true);
    expect(tabBackward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element('#last-inside'));
    closeBtn.click();
    flush();
    expect(document.activeElement).toBe(outsideBtn);
  });
});

describe('SubscribeFeedDialog focus management', () => {
  it('focuses step-2 select after preview and refocuses the active field on error', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'FetchFeedError' }, 422))
      .mockResolvedValueOnce(jsonResponse({ preview: PREVIEW }))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'FeedRepositoryError' }, 500)
      );

    mount(() => (
      <SubscribeFeedDialog
        open={true}
        folders={FOLDERS}
        existingFeeds={[]}
        onClose={vi.fn()}
        onSubscribed={vi.fn()}
        onDuplicateFound={vi.fn()}
      />
    ));
    await Promise.resolve();

    typeInto(FEED_URL);
    await submitAndSettle();
    await Promise.resolve();
    expect(document.activeElement).toBe(element('input[type="url"]'));

    await submitAndSettle();
    await Promise.resolve();
    expect(document.activeElement).toBe(element('select'));

    await submitAndSettle();
    await Promise.resolve();
    expect(document.activeElement).toBe(element('select'));

    const backBtn = Array.from(document.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('返回修改')
    );
    backBtn?.click();
    flush();
    await Promise.resolve();
    expect(document.activeElement).toBe(element('input[type="url"]'));
  });
});
