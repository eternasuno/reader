import {
  type Feed,
  type LibraryClient,
  LibraryError,
  type Scope,
} from '../lib/library';

const ID_CHUNK = 5000;

export const markArticleIds = async (
  client: LibraryClient,
  ids: ReadonlyArray<string>
) => {
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    await client.markArticles(ids.slice(index, index + ID_CHUNK));
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
  ids: ReadonlyArray<string>
) => {
  if (scope.kind === 'later') {
    await client.markLater();

    return;
  }

  if (feedIds !== undefined && feedIds.length > 0) {
    await client.markFeeds(feedIds);

    return;
  }

  await markArticleIds(client, ids);
};

export const duplicateId = (error: unknown): string | undefined =>
  error instanceof LibraryError && error.tag === 'DuplicateArticle'
    ? error.id
    : undefined;

export const errorFeedId = (
  error: unknown,
  tag: 'FeedExists' | 'FeedImportFailed'
): string | undefined =>
  error instanceof LibraryError && error.tag === tag ? error.id : undefined;
