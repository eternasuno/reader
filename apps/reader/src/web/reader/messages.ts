/**
 * The copy of the reader pane (reader.md Messages, plus the two labels it places
 * from later.md): the header row, its actions, the embedded page and the empty
 * reader. The wording of every failure comes from `messageOf` instead.
 */
export const readerMessages = {
  headerLabel: '文章操作',
  back: '返回文章列表',
  previous: '上一篇',
  next: '下一篇',
  markRead: '标为已读',
  markUnread: '标为未读',
  extract: '提取正文',
  extractOff: '切换回原文',
  extracting: '正在提取正文…',
  more: '更多操作',
  menuLabel: '更多文章操作',
  embedded: '嵌入式网页视图',
  openOriginal: '打开原文',
  embeddedNoticeLead: '部分网站不允许内嵌或需要登录；若显示异常，请',
  embeddedNoticeTail: '。',
  notEmbeddable: '此地址不支持安全内嵌，请使用上方链接打开原文。',
  embeddedFrameTitle: '内嵌原网页',
  emptyTitle: '给阅读留一点空间',
  emptyHint: '从左侧选择一篇文章，开始阅读',
  noContent: '暂无内容',
  save: '保存到稍后阅读',
  remove: '删除',
} as const;
