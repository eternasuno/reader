import type { LibraryApi } from '@reader/api';
import { Cause, Option, Schema } from 'effect';
import { HttpClientError } from 'effect/http';
import type { HttpApi, HttpApiGroup } from 'effect/http-api';

type Groups =
  typeof LibraryApi extends HttpApi.HttpApi<string, infer G> ? G : never;

type Group = HttpApiGroup.WithIdentifier<Groups, 'library'>;

type Endpoints = Group['endpoints'];

type ContractErrorTag =
  | Endpoints[keyof Endpoints]['~Error']['Type']['_tag']
  | HttpApiGroup.MiddlewareError<Group>['_tag'];

export type LibraryErrorTag =
  | ContractErrorTag
  | 'RequestFailed'
  | 'NetworkError'
  | 'InvalidResponse';

export const libraryErrorMessages: Record<LibraryErrorTag, string> = {
  Unauthorized: '登录状态已失效，请重新登录',
  Forbidden: '不允许跨站修改',
  AuthUnavailable: '登录服务暂时不可用，请稍后重试',
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
  InvalidFolderName: '请输入目录名称',
  FolderAlreadyExists: '该目录名称已存在',
  FolderNotFound: '目录不存在，可能已被删除',
  FolderRepositoryError: '暂时无法访问目录，请稍后重试',
  InvalidRetention: '保留数量必须是正整数',
  InvalidEndpoint: '请输入有效的浏览器服务地址',
  BrowserEndpointRequired: '请填写浏览器服务地址',
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

const isLibraryErrorTag = (value: string): value is LibraryErrorTag =>
  Object.hasOwn(libraryErrorMessages, value);

const textField = (value: unknown, key: string): string | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const field: unknown = Reflect.get(value, key);

  return typeof field === 'string' ? field : undefined;
};

const contractTag = (error: unknown): LibraryErrorTag | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const tag: unknown = Reflect.get(error, '_tag');

  return typeof tag === 'string' && isLibraryErrorTag(tag) ? tag : undefined;
};

const httpClientTag = (
  error: HttpClientError.HttpClientError
): LibraryErrorTag =>
  error.reason._tag === 'TransportError' ? 'NetworkError' : 'RequestFailed';

/** Maps the first failure of a failed effect to the wording table. */
export const toLibraryError = (cause: Cause.Cause<unknown>): LibraryError => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  const tag = contractTag(error);

  if (tag !== undefined) {
    return new LibraryError(tag, {
      id: textField(error, 'id'),
      url: textField(error, 'url'),
    });
  }

  if (Schema.isSchemaError(error)) {
    return new LibraryError('InvalidResponse');
  }

  return HttpClientError.isHttpClientError(error)
    ? new LibraryError(httpClientTag(error))
    : new LibraryError('RequestFailed');
};
