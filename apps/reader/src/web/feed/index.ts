/**
 * Feeds (feeds.md) and the `订阅源` section of the sidebar (folders.md): the feed
 * list and the per-feed unread counts, the sidebar load, the section with its
 * add menu, the subscribe dialog, unsubscribing, a feed's preferences and a
 * feed scope's extra menu items. Every other module imports from here only.
 */

export type { CountsSnapshot } from './counts';
export {
  adjustFeedUnread,
  allUnreadCount,
  clearUnread,
  countsSnapshot,
  feedUnreadCount,
  folderUnreadCount,
  reloadCounts,
  restoreCounts,
} from './counts';
export type { Feed, FeedOrder, FeedReaderMode } from './list';
export { feedById, feedOrder, feedReaderMode, feeds } from './list';
export { FeedMenuItems } from './menu';
export { FeedSection } from './section';
export { loadSidebar } from './sidebar';
export { openSubscribe } from './subscribe';
export { SubscribeDialog } from './subscribe-dialog';
export { confirmUnsubscribe, unsubscribeFeed } from './unsubscribe';
