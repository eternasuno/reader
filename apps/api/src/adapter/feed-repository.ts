import { createHash } from 'node:crypto';
import {
  type Feed,
  type FeedArticle,
  type FeedImport,
  FeedRepository,
  FeedRepositoryError,
} from '@reader/business';
import { Effect, Layer } from 'effect';
import type { Surreal } from 'surrealdb';
import { Database } from '../infrastructure/db';

type Bindings = Record<string, unknown>;

type SyncRow = {
  readonly key: string;
  readonly url: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly description?: string;
};

const MAX_TRANSACTION_ATTEMPTS = 3;

const hash = (...values: string[]) =>
  createHash('sha256').update(JSON.stringify(values)).digest('hex');

const queryRows = <A>(db: Surreal, sql: string, bindings: Bindings) =>
  Effect.tryPromise({
    try: () => db.query<[A]>(sql, bindings),
    catch: (cause) => new FeedRepositoryError({ cause }),
  }).pipe(Effect.map(([rows]) => rows));

const lastRows = <A>(results: readonly unknown[]): A[] => {
  for (let index = results.length - 1; index >= 0; index--) {
    const value = results[index];
    if (Array.isArray(value)) {
      return value as A[];
    }
  }

  return [];
};

const queryLastRows = <A>(db: Surreal, sql: string, bindings: Bindings) =>
  Effect.tryPromise({
    try: () => db.query<unknown[]>(sql, bindings),
    catch: (cause) => new FeedRepositoryError({ cause }),
  }).pipe(Effect.map((results) => lastRows<A>(results)));

const isTransactionConflict = (cause: unknown): boolean =>
  cause instanceof Error && /retry the transaction/i.test(cause.message);

const runCommand = (db: Surreal, sql: string, bindings: Bindings) =>
  Effect.tryPromise({
    try: () => db.query(sql, bindings),
    catch: (cause) => new FeedRepositoryError({ cause }),
  }).pipe(Effect.asVoid);

const selectFeeds = (db: Surreal, owner: string) =>
  queryRows<Feed[]>(
    db,
    'SELECT key, url, title, updatedAt, error, array::len((SELECT VALUE key FROM feed_article WHERE owner = $owner AND feedKey = $parent.key AND read = false)) AS unreadCount FROM feed WHERE owner = $owner ORDER BY title;',
    { owner }
  );

const selectFeed = (db: Surreal, owner: string, key: string) =>
  queryRows<Feed[]>(
    db,
    'SELECT key, url, title, updatedAt, error, array::len((SELECT VALUE key FROM feed_article WHERE owner = $owner AND feedKey = $parent.key AND read = false)) AS unreadCount FROM feed WHERE owner = $owner AND key = $key;',
    { owner, key }
  ).pipe(Effect.map((items) => items[0]));

const deleteFeedRows = (db: Surreal, owner: string, key: string) =>
  runCommand(
    db,
    'BEGIN TRANSACTION; DELETE feed_article WHERE owner = $owner AND feedKey = $key; DELETE feed WHERE owner = $owner AND key = $key; COMMIT TRANSACTION;',
    { owner, key }
  );

const removeFeed = (db: Surreal, owner: string, key: string) =>
  Effect.gen(function* () {
    const existing = yield* selectFeed(db, owner, key);
    if (!existing) {
      return false;
    }

    yield* deleteFeedRows(db, owner, key);

    return true;
  });

const buildSyncRows = (
  owner: string,
  key: string,
  imported: FeedImport
): readonly SyncRow[] =>
  imported.articles.map((item) => ({
    key: hash(owner, key, item.identity),
    url: item.url,
    title: item.title,
    ...(item.description === undefined
      ? {}
      : { description: item.description }),
    publishedAt: item.publishedAt,
  }));

const syncFeedRows = (
  db: Surreal,
  owner: string,
  key: string,
  imported: FeedImport,
  now: string
) =>
  runCommand(
    db,
    `BEGIN TRANSACTION;
IF array::len(SELECT id FROM feed WHERE owner = $owner AND key = $key) > 0 {
  FOR $article IN $articles {
    UPSERT type::record("feed_article", $article.key) SET owner = $owner, feedKey = $key, key = $article.key, url = $article.url, title = $article.title, publishedAt = $article.publishedAt, description = $article.description, read = false WHERE owner = NONE;
    UPDATE type::record("feed_article", $article.key) SET description = $article.description WHERE owner = $owner AND feedKey = $key;
  };
  UPDATE feed SET title = $title, updatedAt = $now, error = "" WHERE owner = $owner AND key = $key;
  LET $expired = SELECT key, publishedAt FROM feed_article WHERE owner = $owner AND feedKey = $key ORDER BY publishedAt DESC, key DESC START $retention;
  FOR $old IN $expired { DELETE feed_article WHERE owner = $owner AND feedKey = $key AND key = $old.key; };
};
COMMIT TRANSACTION;`,
    {
      owner,
      key,
      articles: buildSyncRows(owner, key, imported),
      title: imported.title,
      retention: imported.retention,
      now,
    }
  );

const createSubscribedFeed = (
  db: Surreal,
  owner: string,
  url: string,
  imported: FeedImport,
  now: string
) =>
  Effect.gen(function* () {
    const key = hash(owner, url);
    const items = yield* queryLastRows<Feed>(
      db,
      `BEGIN TRANSACTION;
LET $created = UPSERT type::record("feed", $key) SET owner = $owner, key = $key, url = $url, title = $title, updatedAt = $now, error = "" WHERE owner = NONE RETURN AFTER;
IF array::len($created) > 0 {
  FOR $article IN $articles {
    UPSERT type::record("feed_article", $article.key) SET owner = $owner, feedKey = $key, key = $article.key, url = $article.url, title = $article.title, publishedAt = $article.publishedAt, description = $article.description, read = false WHERE owner = NONE;
  };
  LET $expired = SELECT key, publishedAt FROM feed_article WHERE owner = $owner AND feedKey = $key ORDER BY publishedAt DESC, key DESC START $retention;
  FOR $old IN $expired { DELETE feed_article WHERE owner = $owner AND feedKey = $key AND key = $old.key; };
};
SELECT key, url, title, updatedAt, error, array::len((SELECT VALUE key FROM feed_article WHERE owner = $owner AND feedKey = $parent.key AND read = false)) AS unreadCount FROM feed WHERE owner = $owner AND key = $key;
COMMIT TRANSACTION;`,
      {
        owner,
        key,
        url,
        title: imported.title,
        articles: buildSyncRows(owner, key, imported),
        retention: imported.retention,
        now,
      }
    );
    const created = items[0];
    if (!created) {
      return yield* new FeedRepositoryError({
        cause: new Error('Subscription creation failed'),
      });
    }

    return created;
  });

const subscribeWithRetry = (
  db: Surreal,
  owner: string,
  url: string,
  imported: FeedImport,
  now: string,
  attempts = MAX_TRANSACTION_ATTEMPTS
): Effect.Effect<Feed, FeedRepositoryError> =>
  createSubscribedFeed(db, owner, url, imported, now).pipe(
    Effect.catchIf(
      (error) => attempts > 1 && isTransactionConflict(error.cause),
      () => subscribeWithRetry(db, owner, url, imported, now, attempts - 1)
    )
  );

const failFeed = (db: Surreal, owner: string, key: string, message: string) =>
  queryRows(
    db,
    'UPDATE feed SET error = $message WHERE owner = $owner AND key = $key;',
    { owner, key, message }
  ).pipe(Effect.asVoid);

const selectArticles = (
  db: Surreal,
  owner: string,
  feedKey: string,
  read: boolean,
  offset: number,
  limit: number,
  all: boolean,
  before: string,
  beforeKey: string
) =>
  queryRows<FeedArticle[]>(
    db,
    'SELECT key, feedKey, url, title, publishedAt, read, description FROM feed_article WHERE owner = $owner AND ($feedKey = "" OR feedKey = $feedKey) AND ($all = true OR read = $read) AND ($before = "" OR publishedAt < $before OR (publishedAt = $before AND key < $beforeKey)) ORDER BY publishedAt DESC, key DESC LIMIT $limit START $offset;',
    { owner, feedKey, read, all, before, beforeKey, offset, limit }
  );

const updateAllArticlesRead = (db: Surreal, owner: string, feedKey: string) =>
  runCommand(
    db,
    'UPDATE feed_article SET read = true WHERE owner = $owner AND ($feedKey = "" OR feedKey = $feedKey) AND read = false;',
    { owner, feedKey }
  );

const updateLoadedArticlesRead = (
  db: Surreal,
  owner: string,
  keys: readonly string[]
) =>
  runCommand(
    db,
    'UPDATE feed_article SET read = true WHERE owner = $owner AND key IN $keys AND read = false;',
    { owner, keys }
  );

const updateArticleRead = (
  db: Surreal,
  owner: string,
  key: string,
  read: boolean
) =>
  queryRows<FeedArticle[]>(
    db,
    'UPDATE feed_article SET read = $read WHERE owner = $owner AND key = $key RETURN AFTER;',
    { owner, key, read }
  ).pipe(Effect.map((items) => items.length > 0));

const selectArticle = (db: Surreal, owner: string, key: string) =>
  queryRows<FeedArticle[]>(
    db,
    'SELECT key, feedKey, url, title, publishedAt, read, description FROM feed_article WHERE owner = $owner AND key = $key;',
    { owner, key }
  ).pipe(Effect.map((items) => items[0]));

const selectSubscriptions = (db: Surreal) =>
  queryRows<{ owner: string; key: string }[]>(
    db,
    'SELECT owner, key FROM feed;',
    {}
  );

export const FeedRepositoryLive = Layer.effect(
  FeedRepository,
  Effect.gen(function* () {
    const db = yield* Database;

    return FeedRepository.of({
      list: (owner) => selectFeeds(db, owner),
      find: (owner, key) => selectFeed(db, owner, key),
      createSubscribed: (owner, url, imported, now) =>
        subscribeWithRetry(db, owner, url, imported, now),
      remove: (owner, key) => removeFeed(db, owner, key),
      sync: (owner, key, imported, now) =>
        syncFeedRows(db, owner, key, imported, now),
      failure: (owner, key, message) => failFeed(db, owner, key, message),
      articles: (
        owner,
        feedKey,
        read,
        offset,
        limit,
        all = false,
        before = '',
        beforeKey = ''
      ) =>
        selectArticles(
          db,
          owner,
          feedKey,
          read,
          offset,
          limit,
          all,
          before,
          beforeKey
        ),
      mark: (owner, key, read) => updateArticleRead(db, owner, key, read),
      markAll: (owner, feedKey) => updateAllArticlesRead(db, owner, feedKey),
      markLoaded: (owner, keys) => updateLoadedArticlesRead(db, owner, keys),
      article: (owner, key) => selectArticle(db, owner, key),
      subscriptions: selectSubscriptions(db),
    });
  })
);
