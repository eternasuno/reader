export type LibraryErrorTag =
  | 'Unauthorized'
  | 'Forbidden'
  | 'InvalidCursor'
  | 'ArticleRepositoryError'
  | 'InvalidArticleUrl'
  | 'ArticleNotFound'
  | 'ArticleNotInFeed'
  | 'ArticleNotLater'
  | 'ArticleMissingUrl'
  | 'ArticleEmptyContent'
  | 'DuplicateArticle'
  | 'SettingsRepositoryError'
  | 'WebpageFetcherError'
  | 'ArticleExtractorError'
  | 'FeedUrlInvalid'
  | 'FeedExists'
  | 'FeedNotFound'
  | 'FeedImportFailed'
  | 'FetchFeedError'
  | 'FeedParserError'
  | 'FeedRepositoryError'
  | 'RequestFailed'
  | 'NetworkError'
  | 'InvalidResponse';

const libraryErrorMessages: Record<LibraryErrorTag, string> = {
  Unauthorized: '登录状态已失效，请重新登录',
  Forbidden: '不允许跨站修改',
  InvalidCursor: '列表已更新，请刷新后重试',
  ArticleRepositoryError: '暂时无法访问文章，请稍后重试',
  InvalidArticleUrl: '请输入有效的 http 或 https 链接',
  ArticleNotFound: '文章不存在，可能已被删除',
  ArticleNotInFeed: '该文章不属于任何订阅',
  ArticleNotLater: '订阅文章不能从稍后阅读中删除',
  ArticleMissingUrl: '该文章没有原始链接',
  ArticleEmptyContent: '未能提取到文章内容',
  DuplicateArticle: '该文章已在稍后阅读中',
  SettingsRepositoryError: '正文提取设置暂时不可用，请稍后重试',
  WebpageFetcherError: '网页抓取失败，请稍后重试',
  ArticleExtractorError: '正文提取失败，请稍后重试',
  FeedUrlInvalid: '请输入有效的订阅地址',
  FeedExists: '该订阅已存在',
  FeedNotFound: '订阅不存在，可能已被删除',
  FeedImportFailed: '订阅文章导入失败，请稍后重试',
  FetchFeedError: '无法获取订阅内容，请稍后重试',
  FeedParserError: '无法解析订阅源，请确认地址正确',
  FeedRepositoryError: '暂时无法访问订阅，请稍后重试',
  RequestFailed: '请求失败，请稍后重试',
  NetworkError: '网络连接失败，请检查网络后重试',
  InvalidResponse: '响应数据格式不正确，请稍后重试',
};

export class LibraryError extends Error {
  readonly tag: LibraryErrorTag;
  readonly id: string | undefined;

  constructor(
    tag: LibraryErrorTag,
    detail: {
      readonly id?: string | undefined;
    } = {}
  ) {
    super(libraryErrorMessages[tag]);
    this.name = 'LibraryError';
    this.tag = tag;
    this.id = detail.id;
  }
}

export const libraryErrorMessage = (error: unknown): string =>
  error instanceof LibraryError ? error.message : '操作失败，请稍后重试';

export const isLibraryErrorTag = (value: string): value is LibraryErrorTag =>
  Object.hasOwn(libraryErrorMessages, value);
