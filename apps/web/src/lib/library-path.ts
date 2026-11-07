import { Option } from 'effect';
import type { Article } from './library-types';

export const articlePath = (article: Article): string => {
  const id = encodeURIComponent(article.id);
  const feedId = Option.getOrUndefined(article.feedId);

  return feedId === undefined
    ? `/read/link/${id}`
    : `/read/feed/${encodeURIComponent(feedId)}/${id}`;
};
