import { DateTime, Effect, Option, Schema, type Semaphore } from 'effect';
import { RecordId, type Surreal } from 'surrealdb';
import {
  Article,
  ArticleId,
} from '../../../../packages/business/src/entity/article.ts';
import {
  FeedId,
  type OwnerId,
} from '../../../../packages/business/src/entity/object-value.ts';
import {
  type ArticlePatch,
  type ArticleQuery,
  ArticleRepository,
  type ArticleRepositoryError,
} from '../../../../packages/business/src/port/article-repository.ts';
import {
  articleRepositoryError,
  articles,
  type Bindings,
  one,
  read,
  run,
  write,
} from './reader-store-sql';

const ARTICLE_COLUMNS =
  'articleId AS id, owner AS ownerId, feedId, url, title, description, content, extractedContent, publishedAt, read';

const encodeArticle = Schema.encodeSync(Article);

type PatchScope = {
  readonly clause: string;
  readonly bindings: Bindings;
};

const LATER_SCOPE: PatchScope = { clause: 'feedId = NONE', bindings: {} };
const ALL_FEEDS_SCOPE: PatchScope = { clause: 'feedId != NONE', bindings: {} };

const articleScope = (ids: readonly ArticleId[]): PatchScope | undefined =>
  ids.length === 0
    ? undefined
    : { clause: 'articleId IN $ids', bindings: { ids } };

const feedsScope = (
  feedIds: Option.Option<readonly FeedId[]>
): PatchScope | undefined =>
  Option.match(feedIds, {
    onNone: () => ALL_FEEDS_SCOPE,
    onSome: (ids) =>
      ids.length === 0
        ? undefined
        : { clause: 'feedId IN $feedIds', bindings: { feedIds: [...ids] } },
  });

const createArticles = (
  db: Surreal,
  owner: OwnerId,
  items: readonly Article[]
) => {
  if (items.length === 0) {
    return Effect.succeed([] as readonly ArticleId[]);
  }

  const feedIds = [
    ...new Set(items.flatMap((item) => Option.toArray(item.feedId))),
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

  return run<unknown, ArticleRepositoryError>(
    db,
    sql,
    bindings,
    articleRepositoryError
  ).pipe(
    Effect.map((results) =>
      items.flatMap((item, index) => {
        const created = results[index + 3];

        return Array.isArray(created) && created.length > 0 ? [item.id] : [];
      })
    )
  );
};

const articlePatchSet = (articlePatch: ArticlePatch) => {
  const fields: string[] = [];
  const bindings: { read?: boolean; extractedContent?: string } = {};

  if (articlePatch.read !== undefined) {
    fields.push('read = $read');
    bindings.read = articlePatch.read;
  }

  if (articlePatch.extractedContent !== undefined) {
    if (Option.isNone(articlePatch.extractedContent)) {
      fields.push('extractedContent = NONE');
    } else {
      fields.push('extractedContent = $extractedContent');
      bindings.extractedContent = articlePatch.extractedContent.value;
    }
  }

  return fields.length === 0
    ? undefined
    : { clause: fields.join(', '), bindings };
};

const updateArticles = (
  db: Surreal,
  owner: OwnerId,
  scope: PatchScope | undefined,
  articlePatch: ArticlePatch
) => {
  const set = articlePatchSet(articlePatch);

  return set === undefined || scope === undefined
    ? Effect.succeed([] as readonly ArticleId[])
    : one<{ articleId: ArticleId }[], ArticleRepositoryError>(
        db,
        `UPDATE article SET ${set.clause} WHERE owner = $owner AND ${scope.clause} RETURN AFTER;`,
        { owner, ...scope.bindings, ...set.bindings },
        articleRepositoryError
      ).pipe(Effect.map((rows) => rows.map((row) => row.articleId)));
};

const removeLaterArticles = (
  db: Surreal,
  owner: OwnerId,
  ids: readonly ArticleId[]
) =>
  ids.length === 0
    ? Effect.void
    : write(
        db,
        'DELETE article WHERE owner = $owner AND articleId IN $ids AND feedId = NONE;',
        { owner, ids },
        articleRepositoryError
      );

const UnreadCountRow = Schema.Struct({
  id: Schema.optionalKey(FeedId),
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const BoundaryRow = Schema.Struct({
  publishedAt: Schema.DateTimeUtcFromDate,
  id: ArticleId,
});

const readUnreadCounts = (db: Surreal, owner: OwnerId) =>
  read(
    db,
    'SELECT feedId AS id, count() AS total FROM article WHERE owner = $owner AND read = false GROUP BY feedId;',
    { owner },
    Schema.Array(UnreadCountRow),
    articleRepositoryError
  ).pipe(
    Effect.map((rows) => {
      const later = rows.find((row) => row.id === undefined)?.total ?? 0;
      const feeds = rows.flatMap((row) =>
        row.id === undefined ? [] : [{ id: row.id, count: row.total }]
      );

      return {
        later,
        feedsTotal: feeds.reduce((sum, feed) => sum + feed.count, 0),
        feeds,
      };
    })
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
    : { afterAt: new Date(query.after.publishedAt), afterId: query.after.id }),
  ...(query.through === undefined
    ? {}
    : {
        throughAt: new Date(query.through.publishedAt),
        throughId: query.through.id,
      }),
});

const pageSql = (query: ArticleQuery, scopeClause: string) =>
  `SELECT ${ARTICLE_COLUMNS} FROM article WHERE owner = $owner AND ${scopeClause}${filterClause(query.filter)}${boundaryClauses(query)} ORDER BY publishedAt DESC, articleId ASC LIMIT $limit;`;

const listArticles = (
  db: Surreal,
  owner: OwnerId,
  query: ArticleQuery,
  scope: PatchScope | undefined
) =>
  scope === undefined
    ? Effect.succeed([] as readonly Article[])
    : articles(
        db,
        pageSql(query, scope.clause),
        pageBindings(owner, query, scope.bindings)
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
    listArticles(db, owner, query, LATER_SCOPE),
  listFeeds: (
    owner: OwnerId,
    feedIds: Option.Option<readonly FeedId[]>,
    query: ArticleQuery
  ) => listArticles(db, owner, query, feedsScope(feedIds)),
  unreadCounts: (owner: OwnerId) => readUnreadCounts(db, owner),
  inventory: (owner: OwnerId, feedId: FeedId) =>
    read(
      db,
      'SELECT publishedAt, articleId AS id FROM article WHERE owner = $owner AND feedId = $feedId ORDER BY publishedAt DESC, articleId ASC;',
      { owner, feedId },
      Schema.Array(BoundaryRow),
      articleRepositoryError
    ).pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          ...row,
          publishedAt: DateTime.formatIso(row.publishedAt),
        }))
      )
    ),
});

const makeArticleWrites = (db: Surreal, lock: Semaphore.Semaphore) => ({
  create: (owner: OwnerId, items: readonly Article[]) =>
    createArticles(db, owner, items).pipe(lock.withPermit),
  updateByArticleIds: (
    owner: OwnerId,
    ids: readonly ArticleId[],
    articlePatch: ArticlePatch
  ) =>
    updateArticles(db, owner, articleScope(ids), articlePatch).pipe(
      lock.withPermit
    ),
  updateLater: (owner: OwnerId, articlePatch: ArticlePatch) =>
    updateArticles(db, owner, LATER_SCOPE, articlePatch).pipe(lock.withPermit),
  updateFeeds: (
    owner: OwnerId,
    feedIds: Option.Option<readonly FeedId[]>,
    articlePatch: ArticlePatch
  ) =>
    updateArticles(db, owner, feedsScope(feedIds), articlePatch).pipe(
      lock.withPermit
    ),
  removeLater: (owner: OwnerId, ids: readonly ArticleId[]) =>
    removeLaterArticles(db, owner, ids).pipe(lock.withPermit),
});

const makeArticleRetention = (db: Surreal, lock: Semaphore.Semaphore) => ({
  retain: (owner: OwnerId, feedId: FeedId, ids: readonly ArticleId[]) =>
    write(
      db,
      ids.length === 0
        ? 'DELETE article WHERE owner = $owner AND feedId = $feedId;'
        : 'DELETE article WHERE owner = $owner AND feedId = $feedId AND articleId NOT IN $ids;',
      { owner, feedId, ids },
      articleRepositoryError
    ).pipe(lock.withPermit),
});

export const makeArticles = (db: Surreal, lock: Semaphore.Semaphore) =>
  ArticleRepository.of({
    ...makeArticleQueries(db),
    ...makeArticleWrites(db, lock),
    ...makeArticleRetention(db, lock),
  });
