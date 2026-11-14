import type { LibraryApi } from '@reader/api';
import type {
  Feed as FeedEntity,
  FeedItem,
  Folder as FolderEntity,
  SavedPage,
} from '@reader/business';
import { DateTime, Option } from 'effect';
import type {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from 'effect/http-api';
import type { Article, ArticleRef, Feed, Folder, Preview } from './types';

type Groups =
  typeof LibraryApi extends HttpApi.HttpApi<string, infer G> ? G : never;

type Endpoints = HttpApiGroup.WithIdentifier<Groups, 'library'>['endpoints'];

type PreviewEndpoint = HttpApiEndpoint.WithIdentifier<
  Endpoints[keyof Endpoints],
  'preview'
>;

type PreviewItem = HttpApiClient.SuccessType<
  PreviewEndpoint['~Success']
>['preview'];

export const savedPageArticle = (page: SavedPage): Article => ({
  id: page.id,
  feedId: Option.none(),
  url: Option.some(page.url.href),
  title: page.title,
  description: page.description,
  content: Option.some(page.content),
  extractedContent: Option.some(page.content),
  publishedAt: Option.match(page.publishedAt, {
    onNone: () => undefined,
    onSome: (value) => DateTime.formatIso(value),
  }),
  read: page.read,
});

export const feedItemArticle = (item: FeedItem): Article => ({
  id: item.id,
  feedId: Option.some(item.feedId),
  url: Option.some(item.url.href),
  title: item.title,
  description: item.description,
  content: item.content,
  extractedContent: item.extractedContent,
  publishedAt: Option.match(item.publishedAt, {
    onNone: () => undefined,
    onSome: (value) => DateTime.formatIso(value),
  }),
  read: item.read,
});

export const feedView = (feed: FeedEntity): Feed => ({
  id: feed.id,
  ownerId: feed.ownerId,
  url: feed.url.href,
  title: feed.title,
  updatedAt: Option.map(feed.updatedAt, (value) => DateTime.formatIso(value)),
  folderId: feed.folderId,
});

export const folderView = (folder: FolderEntity): Folder => ({
  id: folder.id,
  ownerId: folder.ownerId,
  name: folder.name,
});

export const previewView = (preview: PreviewItem): Preview => ({
  url: preview.url,
  title: preview.title,
  description: Option.fromUndefinedOr(preview.description),
  titles: preview.titles,
});

export const refOf = (article: Article): ArticleRef => ({
  id: article.id,
  feedId: Option.getOrUndefined(article.feedId),
});
