import {
  type Article,
  type LibraryClient,
  refOf,
  type Scope,
} from '../../api/library';

export const markArticleRefs = async (
  client: LibraryClient,
  articles: ReadonlyArray<Article>
) => {
  await client.markArticles(articles.map(refOf));
};

export const markScope = async (client: LibraryClient, scope: Scope) => {
  if (scope.kind === 'later') {
    await client.markLater();

    return;
  }

  if (scope.kind === 'folder') {
    await client.markFolders([scope.folderId]);

    return;
  }

  if (scope.feedId === undefined) {
    await client.markAllFeeds();

    return;
  }

  await client.markFeeds([scope.feedId]);
};
