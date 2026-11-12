import type { Feed } from '../lib/library';
import type { LibraryState } from './library-state';

export const removeFeed = (
  state: LibraryState,
  feed: Feed,
  unread: number
): LibraryState => {
  const feeds = { ...state.counts.feeds };
  delete feeds[feed.id];

  return {
    ...state,
    feeds: state.feeds.filter((item) => item.id !== feed.id),
    counts: {
      ...state.counts,
      feeds,
      feedsTotal: Math.max(0, state.counts.feedsTotal - unread),
    },
  };
};

export const restoreFeed = (
  state: LibraryState,
  feed: Feed,
  unread: number
): LibraryState => ({
  ...state,
  feeds: state.feeds.some((item) => item.id === feed.id)
    ? state.feeds
    : [...state.feeds, feed],
  counts: {
    ...state.counts,
    feeds: { ...state.counts.feeds, [feed.id]: unread },
    feedsTotal: state.counts.feedsTotal + unread,
  },
});

export const upsertFeed = (
  feeds: ReadonlyArray<Feed>,
  feed: Feed
): ReadonlyArray<Feed> =>
  [...feeds.filter((item) => item.id !== feed.id), feed].sort((left, right) =>
    left.title === right.title
      ? left.id.localeCompare(right.id)
      : left.title.localeCompare(right.title)
  );

export const selectFeedByUrl = (
  feeds: ReadonlyArray<Feed>,
  url: string
): Feed | undefined => feeds.find((feed) => feed.url === url);
