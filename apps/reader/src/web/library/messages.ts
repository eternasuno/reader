import type { Scope } from './scope';

/**
 * The library screen's copy (`reader-spec` library.md Messages), plus the empty
 * states of `稍后阅读` (later.md), feeds (feeds.md) and folders (folders.md),
 * which the list shows in their scope.
 */
export const copy = {
  brand: '留白',
  navLabel: '阅读导航',
  sourcesLabel: '阅读来源',
  mobileToggle: '切换导航',
  accountMenuLabel: '用户操作',
  listPaneLabel: '文章列表',
  readerPaneLabel: '正文',
  laterName: '稍后阅读',
  allName: '全部订阅',
  folderFallbackName: '目录',
  feedFallbackName: '订阅',
  loading: '正在加载文章…',
  failedTitle: '暂时无法加载文章',
  failedHint: '请点击上方重试。',
  retry: '重试',
  markLoaded: '将已加载文章标为已读',
  listMenuTrigger: '文章列表菜单',
  listMenuLabel: '文章列表操作',
  listHeadingSuffix: '清单工具',
  filterItem: '只显示未读',
  markAllItem: '全部标记为已读',
  unreadEmptyTitle: '没有未读文章',
  unreadEmptyHint: '所有文章都已读过了。',
  showAllAction: '查看全部文章',
  laterEmptyTitle: '留一篇，慢慢读',
  laterEmptyHint: '保存感兴趣的文章链接，在这里专注阅读。',
  addLinkAction: '新增文章链接',
  allEmptyTitle: '从一个订阅源开始',
  allEmptyHint: '添加 RSS 订阅，让新的文章汇集到这里。',
  feedEmptyTitle: '这个订阅源还没有文章',
  feedEmptyHint: '订阅源刷新后，新的文章会出现在这里。',
  folderNoFeedsTitle: '这个目录还没有订阅源',
  folderNoFeedsHint: '可以从订阅源的菜单把订阅源移动到这里。',
  folderNoArticlesTitle: '这个目录还没有文章',
  folderNoArticlesHint: '订阅源刷新后，新的文章会出现在这里。',
  rowUnreadLabel: (title: string) => `未读：${title}，点击标为已读`,
  rowReadLabel: (title: string) => `已读：${title}，点击标为未读`,
  rowUnreadTitle: '未读，点击标为已读',
  rowReadTitle: '已读，点击标为未读',
  sidebarCount: (count: number) => `${count} 篇未读文章`,
  headingCount: (count: number) => `${count} 篇未读`,
} as const;

/** What the empty list offers as its one recovery (LIB-STATE-2). */
export type EmptyAction = 'show-all' | 'add-link';

export type EmptyCopy = {
  readonly title: string;
  readonly hint: string;
  readonly action?: EmptyAction | undefined;
};

const folderCopy = (hasFeeds: boolean): EmptyCopy =>
  hasFeeds
    ? { title: copy.folderNoArticlesTitle, hint: copy.folderNoArticlesHint }
    : { title: copy.folderNoFeedsTitle, hint: copy.folderNoFeedsHint };

/**
 * The empty state of a scope and filter: the unread filter's shared copy wins,
 * then the scope's own (LIB-STATE-2). `folderHasFeeds` decides which of the two
 * folder states a folder shows.
 */
export const emptyCopy = (
  scope: Scope,
  unreadOnly: boolean,
  folderHasFeeds: boolean
): EmptyCopy => {
  if (unreadOnly) {
    return {
      title: copy.unreadEmptyTitle,
      hint: copy.unreadEmptyHint,
      action: 'show-all',
    };
  }

  if (scope.kind === 'folder') return folderCopy(folderHasFeeds);

  if (scope.kind === 'later') {
    return {
      title: copy.laterEmptyTitle,
      hint: copy.laterEmptyHint,
      action: 'add-link',
    };
  }

  return scope.kind === 'all'
    ? { title: copy.allEmptyTitle, hint: copy.allEmptyHint }
    : { title: copy.feedEmptyTitle, hint: copy.feedEmptyHint };
};

/** The label of the one action an empty list offers (LIB-STATE-2). */
export const emptyActionLabel = (action: EmptyAction): string =>
  action === 'show-all' ? copy.showAllAction : copy.addLinkAction;
