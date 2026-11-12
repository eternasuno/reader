export type LibraryErrorTag =
  | 'Unauthorized'
  | 'Forbidden'
  | 'InvalidPageUrl'
  | 'FeedUrlInvalid'
  | 'FeedItemNotFound'
  | 'SavedPageAlreadyExists'
  | 'FeedAlreadyExists'
  | 'ArticleEmptyContent'
  | 'WebpageFetcherError'
  | 'ArticleExtractorError'
  | 'FetchFeedError'
  | 'FeedParserError'
  | 'FeedItemRepositoryError'
  | 'SavedPageRepositoryError'
  | 'FeedRepositoryError'
  | 'SettingRepositoryError'
  | 'RequestFailed'
  | 'NetworkError'
  | 'InvalidResponse';

const libraryErrorMessages: Record<LibraryErrorTag, string> = {
  Unauthorized: '登录状态已失效，请重新登录',
  Forbidden: '不允许跨站修改',
  InvalidPageUrl: '请输入有效的 http 或 https 链接',
  FeedUrlInvalid: '请输入有效的订阅地址',
  FeedItemNotFound: '文章不存在，可能已被删除',
  SavedPageAlreadyExists: '该文章已在稍后阅读中',
  FeedAlreadyExists: '该订阅已存在',
  ArticleEmptyContent: '未能提取到文章内容',
  WebpageFetcherError: '网页抓取失败，请稍后重试',
  ArticleExtractorError: '正文提取失败，请稍后重试',
  FetchFeedError: '无法获取订阅内容，请稍后重试',
  FeedParserError: '无法解析订阅源，请确认地址正确',
  FeedItemRepositoryError: '暂时无法访问订阅文章，请稍后重试',
  SavedPageRepositoryError: '暂时无法访问稍后阅读，请稍后重试',
  FeedRepositoryError: '暂时无法访问订阅，请稍后重试',
  SettingRepositoryError: '暂时无法访问设置，请稍后重试',
  RequestFailed: '请求失败，请稍后重试',
  NetworkError: '网络连接失败，请检查网络后重试',
  InvalidResponse: '响应数据格式不正确，请稍后重试',
};

export class LibraryError extends Error {
  readonly tag: LibraryErrorTag;
  readonly id: string | undefined;
  readonly url: string | undefined;

  constructor(
    tag: LibraryErrorTag,
    detail: {
      readonly id?: string | undefined;
      readonly url?: string | undefined;
    } = {}
  ) {
    super(libraryErrorMessages[tag]);
    this.name = 'LibraryError';
    this.tag = tag;
    this.id = detail.id;
    this.url = detail.url;
  }
}

export const libraryErrorMessage = (error: unknown): string =>
  error instanceof LibraryError ? error.message : '操作失败，请稍后重试';

export const isLibraryErrorTag = (value: string): value is LibraryErrorTag =>
  Object.hasOwn(libraryErrorMessages, value);
