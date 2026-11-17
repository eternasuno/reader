import { isAuthFailure } from './auth';
import { ApiFailure, type ApiFailureTag, tagOf } from './failure';

/**
 * The one table from contract error tag to Chinese wording: `reader-spec`
 * Shared messages plus every domain file's Messages section. A tag without a
 * wording does not compile, so a new contract error must be added here.
 */
export const apiMessages: Record<ApiFailureTag, string> = {
  // Shared messages
  Unauthorized: '登录状态已失效，请重新登录',
  Forbidden: '不允许跨站修改',
  AuthUnavailable: '登录服务暂时不可用，请稍后重试',
  RequestFailed: '请求失败，请稍后重试',
  NetworkError: '网络连接失败，请检查网络后重试',
  InvalidResponse: '响应数据格式不正确，请稍后重试',
  ArticleEmptyContent: '未能提取到文章内容',
  WebpageFetcherError: '网页抓取失败，请稍后重试',
  ArticleExtractorError: '正文提取失败，请稍后重试',

  // later.md
  InvalidPageUrl: '请输入有效的 http 或 https 链接',
  SavedPageAlreadyExists: '该文章已在稍后阅读中',
  SavedPageRepositoryError: '暂时无法访问稍后阅读，请稍后重试',

  // feeds.md
  FeedUrlInvalid: '请输入有效的订阅地址',
  FetchFeedError: '无法获取订阅内容，请稍后重试',
  FeedParserError: '无法解析订阅源，请确认地址正确',
  FeedAlreadyExists: '该订阅已存在',
  FeedRepositoryError: '暂时无法访问订阅，请稍后重试',
  FeedItemRepositoryError: '暂时无法访问订阅文章，请稍后重试',
  FeedItemNotFound: '文章不存在，可能已被删除',

  // folders.md
  InvalidFolderName: '请输入目录名称',
  FolderAlreadyExists: '该目录名称已存在',
  FolderNotFound: '目录不存在，可能已被删除',
  FolderRepositoryError: '暂时无法访问目录，请稍后重试',

  // settings.md
  InvalidRetention: '保留数量必须是正整数',
  InvalidEndpoint: '请输入有效的浏览器服务地址',
  BrowserEndpointRequired: '请填写浏览器服务地址',
  SettingRepositoryError: '暂时无法访问设置，请稍后重试',
};

/** The shared messages that are not an error tag (reader-spec Shared messages). */
export const sessionMessages = {
  checking: '正在确认登录状态…',
  failed: '暂时无法确认登录状态，请刷新重试。',
} as const;

/** The wording for a failure whose tag has no row: reader-spec Shared messages. */
export const fallbackMessage = '操作失败，请稍后重试';

/** Whether a failure tag has a wording; the table itself decides. */
export const isApiFailureTag = (value: string): value is ApiFailureTag =>
  Object.hasOwn(apiMessages, value);

/**
 * The Chinese wording of anything an `api/` function can reject with: an
 * `ApiFailure` (its tag row), a Better Auth `AuthFailure` (its own wording) or
 * any other value (the fallback). Screens pass the caught value straight here.
 */
export const messageOf = (failure: unknown): string => {
  if (isAuthFailure(failure)) return failure.message;
  if (failure instanceof ApiFailure) return apiMessages[failure.tag];

  const tag = tagOf(failure);

  return tag !== undefined && isApiFailureTag(tag)
    ? apiMessages[tag]
    : fallbackMessage;
};
