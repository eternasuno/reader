import {
  type Article,
  type Feed,
  type LibraryClient,
  LibraryError,
  refOf,
  type Scope,
} from '../lib/library';

const ID_CHUNK = 5000;

export const markArticleRefs = async (
  client: LibraryClient,
  articles: ReadonlyArray<Article>
) => {
  const refs = articles.map(refOf);
  for (let index = 0; index < refs.length; index += ID_CHUNK) {
    await client.markArticles(refs.slice(index, index + ID_CHUNK));
  }
};

export const feedScopeIds = (
  scope: Scope,
  feeds: ReadonlyArray<Feed>
): ReadonlyArray<string> | undefined => {
  if (scope.kind === 'later') {
    return undefined;
  }

  if (scope.feedId !== undefined) {
    return [scope.feedId];
  }

  return feeds.map((feed) => feed.id);
};

export const markScope = async (
  client: LibraryClient,
  scope: Scope,
  feedIds: ReadonlyArray<string> | undefined,
  articles: ReadonlyArray<Article>
) => {
  if (scope.kind === 'later') {
    await client.markLater();

    return;
  }

  if (feedIds !== undefined && feedIds.length > 0) {
    await client.markFeeds(feedIds);

    return;
  }

  await markArticleRefs(client, articles);
};

export const duplicateId = (error: unknown): string | undefined =>
  error instanceof LibraryError && error.tag === 'DuplicateSavedPage'
    ? error.id
    : undefined;

export const errorFeedId = (
  error: unknown,
  tag: 'FeedExists' | 'FeedImportFailed'
): string | undefined =>
  error instanceof LibraryError && error.tag === tag ? error.id : undefined;
