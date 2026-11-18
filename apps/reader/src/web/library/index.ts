/**
 * The library screen's public interface: the shell, the route-derived scope and
 * navigation, the article list store with its paging, the read marking, and the
 * shared sidebar row other scopes' modules render (web-interfaces.md).
 */
export { LibraryPage } from './library-page';
export {
  listState,
  loadNextPage,
  pageSize,
  prependRow,
  reloadList,
  removeRow,
  replaceRow,
  retryList,
  revertRowsRead,
  rowById,
  rows,
  setRowsRead,
} from './list';
export {
  markAllInScope,
  markLoadedRead,
  setArticleRead,
} from './read';
export {
  closeArticle,
  currentScope,
  openArticle,
  openArticleId,
  selectScope,
  setUnreadFilter,
  unreadFilter,
} from './route';
export type { Article, FeedItem, SavedPage, Scope } from './scope';
export { sameScope, scopePath } from './scope';
export { ScopeRow, type ScopeRowProps } from './scope-row';
