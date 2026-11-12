import type { NormalizedUrl } from '@reader/business';

const failure = <Tag extends string>(tag: Tag, message: string) =>
  ({ _tag: tag, message }) as const;

export const invalidPageUrl = () =>
  failure('InvalidPageUrl', '请输入有效的 http 或 https 链接');

export const feedUrlInvalid = () =>
  failure('FeedUrlInvalid', '请输入有效的订阅地址');

export const feedItemNotFound = (error: { readonly id: string }) =>
  ({
    ...failure('FeedItemNotFound', '文章不存在，可能已被删除'),
    id: error.id,
  }) as const;

export const savedPageAlreadyExists = (error: {
  readonly url: NormalizedUrl;
}) =>
  ({
    ...failure('SavedPageAlreadyExists', '该文章已在稍后阅读中'),
    url: error.url.href,
  }) as const;

export const feedAlreadyExists = (error: { readonly url: NormalizedUrl }) =>
  ({
    ...failure('FeedAlreadyExists', '该订阅已存在'),
    url: error.url.href,
  }) as const;

export const articleEmptyContent = () =>
  failure('ArticleEmptyContent', '未能提取到文章内容');

export const webpageFetchError = () =>
  failure('WebpageFetcherError', '网页抓取失败，请稍后重试');

export const articleExtractError = () =>
  failure('ArticleExtractorError', '正文提取失败，请稍后重试');

export const fetchFeedError = () =>
  failure('FetchFeedError', '无法获取订阅内容，请稍后重试');

export const parseFeedError = () =>
  failure('FeedParserError', '无法解析订阅源，请确认地址正确');

export const feedItemRepositoryError = () =>
  failure('FeedItemRepositoryError', '暂时无法访问订阅文章，请稍后重试');

export const savedPageRepositoryError = () =>
  failure('SavedPageRepositoryError', '暂时无法访问稍后阅读，请稍后重试');

export const feedRepositoryError = () =>
  failure('FeedRepositoryError', '暂时无法访问订阅，请稍后重试');

export const settingRepositoryError = () =>
  failure('SettingRepositoryError', '暂时无法访问设置，请稍后重试');

export const invalidRetention = () =>
  failure('InvalidRetention', '保留数量必须是 30 到 300 之间的整数');

export const invalidProvider = () =>
  failure('InvalidProvider', '请选择有效的文章提取方式');

export const invalidKey = () =>
  failure('InvalidKey', '请输入有效的 Jina API Key');

export const invalidEndpoint = () =>
  failure('InvalidEndpoint', '请输入有效的浏览器服务地址');

export const browserEndpointRequired = () =>
  failure('BrowserEndpointRequired', '请填写浏览器服务地址');
