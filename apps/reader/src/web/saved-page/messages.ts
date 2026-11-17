/**
 * The copy of the saved-page screens (later.md Messages): the add dialog, the
 * toast of adding and saving, and the confirmation before removing a page. The
 * wording of a failure comes from `messageOf` instead.
 */
export const savedPageMessages = {
  addTitle: '新增文章链接',
  addDescription: '粘贴文章链接，保存到稍后阅读。',
  urlLabel: '网址',
  urlHint: '请输入有效的 http 或 https 链接',
  urlPlaceholder: '粘贴文章链接…',
  addSubmit: '添加文章',
  addPending: '添加中…',
  added: '文章已添加',
  saved: '已保存到稍后阅读',
  removeAction: '删除',
  removeQuestion: '删除这篇稍后阅读？删除后无法恢复。',
} as const;
