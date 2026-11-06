import { createHash } from 'node:crypto';
import { Option, Struct } from 'effect';
import { Article, ArticleId } from '../entity/article';
import {
  FeedId,
  type NormalizedUrl,
  type OwnerId,
} from '../entity/object-value';

const sha256 = (values: ReadonlyArray<unknown>): string =>
  createHash('sha256').update(JSON.stringify(values)).digest('hex');

export const feedId = (ownerId: OwnerId, url: NormalizedUrl): FeedId =>
  FeedId.make(sha256([ownerId, url.href]));

export const ArticleIdentity = Article.mapFields(
  Struct.pick(['ownerId', 'feedId', 'url', 'title', 'description'])
);

export type ArticleIdentity = typeof ArticleIdentity.Type;

export const articleId = ({
  ownerId,
  feedId,
  url,
  title,
  description,
}: ArticleIdentity): ArticleId =>
  ArticleId.make(
    sha256([
      Option.match(url, { onNone: () => '', onSome: (url) => url.href }),
      title,
      Option.getOrElse(description, () => ''),
      Option.getOrElse(feedId, () => ownerId),
    ])
  );
