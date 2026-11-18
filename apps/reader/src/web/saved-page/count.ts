import { createSignal } from 'solid-js';
import { getSavedPageUnreadCount } from '../api/saved-page';

/**
 * The unread count of `稍后阅读` (SP-COUNT-1), the count LIB-COUNT-1 sums the
 * sidebar from. Every write moves it and then reads it again from the server,
 * which is also what settles a failed one: a failed count request keeps the last
 * known count (LIB-COUNT-2).
 */
const [unreadCount, setUnreadCount] = createSignal(0);

export const savedPageUnreadCount = (): number => unreadCount();

/** Moves the count with an optimistic write (LIB-COUNT-2). */
export const adjustSavedPageUnread = (delta: number): void => {
  setUnreadCount((current) => current + delta);
};

/** Zeroes the count when the whole scope is marked read (LIB-READ-4). */
export const clearSavedPageUnread = (): void => {
  setUnreadCount(0);
};

/** The count the server reports, or undefined when the request failed. */
const readCount = async (): Promise<number | undefined> => {
  try {
    return (await getSavedPageUnreadCount()).count;
  } catch {
    return undefined;
  }
};

/** Reads the count again once a write settled (LIB-COUNT-2). */
export const reloadSavedPageCount = async (): Promise<void> => {
  const count = await readCount();

  if (count !== undefined) setUnreadCount(count);
};
