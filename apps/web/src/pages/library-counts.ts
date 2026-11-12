import { Option } from 'effect';
import type { Article, Counts, Feed, Scope } from '../lib/library';
import { feedsInFolder, folderUnread } from './library-folders';

export const emptyCounts: Counts = { later: 0, feeds: {}, feedsTotal: 0 };

export const withReadCount = (
  counts: Counts,
  article: Article,
  read: boolean
): Counts => {
  const delta = read ? -1 : 1;
  const feedId = Option.getOrUndefined(article.feedId);

  if (feedId === undefined) {
    return { ...counts, later: Math.max(0, counts.later + delta) };
  }

  const unread = counts.feeds[feedId] ?? 0;

  return {
    ...counts,
    feeds: { ...counts.feeds, [feedId]: Math.max(0, unread + delta) },
    feedsTotal: Math.max(0, counts.feedsTotal + delta),
  };
};

export const unreadCount = (
  counts: Counts,
  scope: Scope,
  feeds: ReadonlyArray<Feed>
): number => {
  if (scope.kind === 'later') {
    return counts.later;
  }

  if (scope.kind === 'folder') {
    return folderUnread(counts, feeds, scope.folderId);
  }

  if (scope.feedId === undefined) {
    return counts.feedsTotal;
  }

  return counts.feeds[scope.feedId] ?? 0;
};

const clearFeedCounts = (
  counts: Counts,
  feeds: ReadonlyArray<Feed>
): Counts => {
  const unread = feeds.reduce(
    (sum, feed) => sum + (counts.feeds[feed.id] ?? 0),
    0
  );
  const cleared = { ...counts.feeds };
  for (const feed of feeds) {
    cleared[feed.id] = 0;
  }

  return {
    ...counts,
    feeds: cleared,
    feedsTotal: Math.max(0, counts.feedsTotal - unread),
  };
};

export const clearScopeCounts = (
  counts: Counts,
  scope: Scope,
  feeds: ReadonlyArray<Feed>
): Counts => {
  if (scope.kind === 'later') {
    return { ...counts, later: 0 };
  }

  if (scope.kind === 'folder') {
    return clearFeedCounts(counts, feedsInFolder(feeds, scope.folderId));
  }

  if (scope.feedId === undefined) {
    return { ...counts, feeds: {}, feedsTotal: 0 };
  }

  const unread = counts.feeds[scope.feedId] ?? 0;

  return {
    ...counts,
    feeds: { ...counts.feeds, [scope.feedId]: 0 },
    feedsTotal: Math.max(0, counts.feedsTotal - unread),
  };
};
