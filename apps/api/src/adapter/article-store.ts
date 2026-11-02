import { Effect, Option, Schema, type Semaphore } from 'effect';
import { RecordId, type Surreal } from 'surrealdb';
import type { Article } from '../../../../packages/business/src/entity/article.ts';
import {
  ArticleId,
  FeedId,
  type OwnerId,
} from '../../../../packages/business/src/entity/object-value.ts';
import {
  type ArticleQuery,
  type ArticleReadError,
  ArticleRepository,
  type ArticleWriteError,
} from '../../../../packages/business/src/port/article-repository.ts';
import {
  articleReadError,
  articles,
  articleWriteError,
  type Bindings,
  one,
  read,
  run,
  write,
} from './reader-store-sql';

const ARTICLE_COLUMNS =
  'articleId AS id, owner AS ownerId, feedId, url, title, description, content, extractedContent, publishedAt, read';

const encodeArticle = (article: Article) =>
  Object.fromEntries(
    Object.entries({
      id: article.id,
      feedId: article.feedId,
      url:
        article.url === undefined
          ? undefined
          : Schema.encodeSync(Schema.URLFromString)(article.url),
      title: article.title,
      description: article.description,
      content: article.content,
      extractedContent: article.extractedContent,
      publishedAt: Schema.encodeSync(Schema.DateTimeUtcFromString)(
        article.publishedAt
      ),
      read: article.read,
    }).filter(([, value]) => value !== undefined)
  );

const createArticles = (
  db: Surreal,
  owner: OwnerId,
  items: readonly Article[]
) => {
  if (items.length === 0) {
    return Effect.succeed([] as readonly ArticleId[]);
  }
  const feedIds = [
    ...new Set(items.flatMap((item) => (item.feedId ? [item.feedId] : []))),
  ];
  const bindings: Bindings = {
    owner,
    ids: feedIds.map((id) => new RecordId('feed', id)),
    count: feedIds.length,
  };
  items.forEach((item, index) => {
    bindings[`a${index}`] = encodeArticle(item);
  });
  const inserts = items
    .map(
      (_, index) =>
        `UPSERT type::record("article", $a${index}.id) SET owner = $owner, articleId = $a${index}.id, feedId = $a${index}.feedId, url = $a${index}.url, title = $a${index}.title, description = $a${index}.description, content = $a${index}.content, extractedContent = $a${index}.extractedContent, publishedAt = $a${index}.publishedAt, read = $a${index}.read WHERE owner = NONE RETURN AFTER;`
    )
    .join(' ');
  const sql = `BEGIN TRANSACTION; LET $feeds = SELECT VALUE id FROM feed WHERE owner = $owner AND id IN $ids; IF array::len($feeds) != $count { THROW "Subscription not found or access denied"; }; ${inserts} COMMIT TRANSACTION;`;

  return run<unknown, ArticleWriteError>(
    db,
    sql,
    bindings,
    articleWriteError
  ).pipe(
    Effect.map((results) =>
      items.flatMap((item, index) => {
        const created = results[index + 3];

        return Array.isArray(created) && created.length > 0 ? [item.id] : [];
      })
    )
  );
};

const setArticlesRead = (
  db: Surreal,
  owner: OwnerId,
  ids: readonly ArticleId[],
  readValue: boolean
) =>
  ids.length === 0
    ? Effect.void
    : write(
        db,
        'UPDATE article SET read = $read WHERE owner = $owner AND articleId IN $ids;',
        { owner, ids, read: readValue },
        articleWriteError
      );

const saveExtractedContent = (
  db: Surreal,
  owner: OwnerId,
  id: ArticleId,
  content: string
) =>
  one<unknown[], ArticleWriteError>(
    db,
    'UPDATE type::record("article", $id) SET extractedContent = $content WHERE owner = $owner RETURN AFTER;',
    { owner, id, content },
    articleWriteError
  ).pipe(Effect.map((rows) => rows.length > 0));

const UnreadFeedRow = Schema.Struct({
  id: FeedId,
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const BoundaryRow = Schema.Struct({
  publishedAt: Schema.String,
  id: ArticleId,
});

const countUnreadFeeds = (db: Surreal, owner: OwnerId) =>
  read(
    db,
    'SELECT feedId AS id, count() AS total FROM article WHERE owner = $owner AND feedId != NONE AND read = false GROUP BY feedId;',
    { owner },
    Schema.Array(UnreadFeedRow),
    articleReadError
  ).pipe(
    Effect.map((rows) => ({
      total: rows.reduce((sum, row) => sum + row.total, 0),
      feeds: rows.map((row) => ({ id: row.id, count: row.total })),
    }))
  );

const filterClause = (filter: ArticleQuery['filter']) =>
  filter === 'all' ? '' : ' AND read = $read';

const boundaryClauses = (query: ArticleQuery) => {
  const after =
    query.after === undefined
      ? ''
      : ' AND (publishedAt < $afterAt OR (publishedAt = $afterAt AND articleId > $afterId))';
  const through =
    query.through === undefined
      ? ''
      : ' AND (publishedAt > $throughAt OR (publishedAt = $throughAt AND articleId <= $throughId))';

  return `${after}${through}`;
};

const pageBindings = (
  owner: OwnerId,
  query: ArticleQuery,
  scopeBindings: Bindings = {}
): Bindings => ({
  owner,
  limit: query.limit,
  ...scopeBindings,
  ...(query.filter === 'all' ? {} : { read: query.filter === 'read' }),
  ...(query.after === undefined
    ? {}
    : { afterAt: query.after.publishedAt, afterId: query.after.id }),
  ...(query.through === undefined
    ? {}
    : { throughAt: query.through.publishedAt, throughId: query.through.id }),
});

const pageSql = (query: ArticleQuery, scopeClause: string) =>
  `SELECT ${ARTICLE_COLUMNS} FROM article WHERE owner = $owner AND ${scopeClause}${filterClause(query.filter)}${boundaryClauses(query)} ORDER BY publishedAt DESC, articleId ASC LIMIT $limit;`;

const listLaterArticles = (db: Surreal, owner: OwnerId, query: ArticleQuery) =>
  articles(db, pageSql(query, 'feedId = NONE'), pageBindings(owner, query));

const listFeedArticles = (
  db: Surreal,
  owner: OwnerId,
  feedId: FeedId | undefined,
  query: ArticleQuery
) =>
  articles(
    db,
    pageSql(
      query,
      feedId === undefined ? 'feedId != NONE' : 'feedId = $feedId'
    ),
    pageBindings(owner, query, feedId === undefined ? {} : { feedId })
  );

const findArticle = (db: Surreal, owner: OwnerId, id: ArticleId) =>
  articles(
    db,
    `SELECT ${ARTICLE_COLUMNS} FROM article WHERE owner = $owner AND id = type::record("article", $id);`,
    { owner, id }
  ).pipe(Effect.map((items) => Option.fromNullishOr(items[0])));

const makeArticleQueries = (db: Surreal) => ({
  find: (owner: OwnerId, id: ArticleId) => findArticle(db, owner, id),
  listLater: (owner: OwnerId, query: ArticleQuery) =>
    listLaterArticles(db, owner, query),
  listFeeds: (
    owner: OwnerId,
    feedId: FeedId | undefined,
    query: ArticleQuery
  ) => listFeedArticles(db, owner, feedId, query),
  unreadLater: (owner: OwnerId) =>
    one<{ total: number }[], ArticleReadError>(
      db,
      'SELECT count() AS total FROM article WHERE owner = $owner AND feedId = NONE AND read = false GROUP ALL;',
      { owner },
      articleReadError
    ).pipe(Effect.map((rows) => rows[0]?.total ?? 0)),
  unreadFeeds: (owner: OwnerId) => countUnreadFeeds(db, owner),
  inventory: (owner: OwnerId, feedId: FeedId) =>
    read(
      db,
      'SELECT publishedAt, articleId AS id FROM article WHERE owner = $owner AND feedId = $feedId ORDER BY publishedAt DESC, articleId ASC;',
      { owner, feedId },
      Schema.Array(BoundaryRow),
      articleReadError
    ),
});

const makeArticleWrites = (db: Surreal, lock: Semaphore.Semaphore) => ({
  create: (owner: OwnerId, items: readonly Article[]) =>
    createArticles(db, owner, items).pipe(lock.withPermit),
  setRead: (owner: OwnerId, ids: readonly ArticleId[], readValue: boolean) =>
    setArticlesRead(db, owner, ids, readValue).pipe(lock.withPermit),
  markLater: (owner: OwnerId) =>
    write(
      db,
      'UPDATE article SET read = true WHERE owner = $owner AND feedId = NONE AND read = false;',
      { owner },
      articleWriteError
    ).pipe(lock.withPermit),
  markFeeds: (owner: OwnerId, ids: readonly FeedId[]) =>
    ids.length === 0
      ? Effect.void
      : write(
          db,
          'UPDATE article SET read = true WHERE owner = $owner AND feedId IN $ids AND read = false;',
          { owner, ids },
          articleWriteError
        ).pipe(lock.withPermit),
  removeLater: (owner: OwnerId, id: ArticleId) =>
    write(
      db,
      'DELETE article WHERE owner = $owner AND articleId = $id AND feedId = NONE;',
      { owner, id },
      articleWriteError
    ).pipe(lock.withPermit),
  saveExtracted: (owner: OwnerId, id: ArticleId, content: string) =>
    saveExtractedContent(db, owner, id, content).pipe(lock.withPermit),
});

const makeArticleRetention = (db: Surreal, lock: Semaphore.Semaphore) => ({
  retain: (owner: OwnerId, feedId: FeedId, ids: readonly ArticleId[]) =>
    write(
      db,
      ids.length === 0
        ? 'DELETE article WHERE owner = $owner AND feedId = $feedId;'
        : 'DELETE article WHERE owner = $owner AND feedId = $feedId AND articleId NOT IN $ids;',
      { owner, feedId, ids },
      articleWriteError
    ).pipe(lock.withPermit),
});

export const makeArticles = (db: Surreal, lock: Semaphore.Semaphore) =>
  ArticleRepository.of({
    ...makeArticleQueries(db),
    ...makeArticleWrites(db, lock),
    ...makeArticleRetention(db, lock),
  });
