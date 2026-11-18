import { createSignal } from 'solid-js';
import { sendToKindle } from '../../api/kindle';
import { messageOf } from '../../api/messages';
import { showToast } from '../../ui/toast';
import { kindleMessages as copy, sentToKindle } from './messages';

/**
 * Sending every unread article now (kindle.md Interface). A send is not a
 * settings write: it has its own pending flag, it does not take the page's one
 * write and the rest of the page stays usable while it runs.
 */

const [sending, setSending] = createSignal(false);

/** Whether a send-now request runs: the button's pending state. */
export const kindleSending = sending;

/**
 * Sends at once with the stored delivery, never with the unsaved drafts, and
 * reports the count it answered (KD-SEND-8): articles sent, nothing unread, or
 * the wording of the failure.
 */
export const sendNow = async (): Promise<void> => {
  if (sending()) return;

  setSending(true);

  try {
    const { count } = await sendToKindle();

    showToast(count > 0 ? sentToKindle(count) : copy.nothingUnread);
  } catch (error) {
    showToast(messageOf(error), 'error');
  } finally {
    setSending(false);
  }
};
