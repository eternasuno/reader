import {
  type Article,
  type LibraryClient,
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

export const markScope = async (client: LibraryClient, scope: Scope) => {
  if (scope.kind === 'later') {
    await client.markLater();

    return;
  }

  if (scope.feedId === undefined) {
    await client.markAllFeeds();

    return;
  }

  await client.markFeeds([scope.feedId]);
};
