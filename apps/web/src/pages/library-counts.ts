import { Option } from 'effect';
import type { Article, Counts, Scope } from '../lib/library';

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

export const unreadCount = (counts: Counts, scope: Scope): number => {
  if (scope.kind === 'later') {
    return counts.later;
  }
  if (scope.feedId === undefined) {
    return counts.feedsTotal;
  }

  return counts.feeds[scope.feedId] ?? 0;
};

export const clearScopeCounts = (counts: Counts, scope: Scope): Counts => {
  if (scope.kind === 'later') {
    return { ...counts, later: 0 };
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
