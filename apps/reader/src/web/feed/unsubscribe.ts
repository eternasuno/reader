import { unsubscribeFeed as requestUnsubscribe } from '../api/feed';
import { messageOf } from '../api/messages';
import { currentScope, selectScope } from '../library';
import { showToast } from '../ui/toast';
import { type CountsSnapshot, countsSnapshot, restoreCounts } from './counts';
import { type Feed, feeds, setFeeds } from './list';

/** The question before unsubscribing (feeds.md Messages). */
export const unsubscribeQuestion =
  '取消订阅并删除该源的文章？已保存的稍后阅读不会删除。';

type BeforeRemoval = {
  readonly feedList: ReadonlyArray<Feed>;
  readonly counts: CountsSnapshot;
};

/** Removes the row and its count at once and returns what a rollback needs. */
const removeLocally = (feedId: string): BeforeRemoval => {
  const before = { feedList: feeds(), counts: countsSnapshot() };
  const counts = new Map(before.counts);

  counts.delete(feedId);
  setFeeds(before.feedList.filter((feed) => feed.id !== feedId));
  restoreCounts(counts);

  return before;
};

const restore = (before: BeforeRemoval): void => {
  setFeeds(before.feedList);
  restoreCounts(before.counts);
};

/** Leaves a scope that the removal emptied for `全部订阅` (feeds.md Unsubscribing). */
const leaveRemovedScope = (feedId: string): void => {
  const scope = currentScope();

  if (scope.kind === 'feed' && scope.id === feedId)
    selectScope({ kind: 'all' });
};

/**
 * Removes the feed with its items and its count; saved pages stay (FD-UNSUB-3,
 * FD-UNSUB-4). A failure puts the row, its count and its items back and shows
 * the error; there is no success toast (feeds.md Unsubscribing).
 */
export const unsubscribeFeed = async (feedId: string): Promise<void> => {
  const before = removeLocally(feedId);

  try {
    await requestUnsubscribe(feedId);
  } catch (error) {
    restore(before);
    showToast(messageOf(error), 'error');

    return;
  }

  leaveRemovedScope(feedId);
};

/** Asks through the browser's confirm, then unsubscribes; cancelling changes nothing. */
export const confirmUnsubscribe = (feed: Feed): void => {
  if (!globalThis.confirm(unsubscribeQuestion)) return;

  void unsubscribeFeed(feed.id);
};
