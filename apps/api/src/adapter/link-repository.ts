import { createHash } from 'node:crypto';
import {
  LinkRepository,
  LinkRepositoryError,
  type ReadingLink,
} from '@reader/business';
import { Effect, Layer } from 'effect';
import { Database } from '../infrastructure/db';

export const LinkRepositoryLive = Layer.effect(
  LinkRepository,
  Effect.gen(function* () {
    const db = yield* Database;
    const query = (sql: string, bindings: Record<string, unknown>) =>
      Effect.tryPromise({
        try: () => db.query<[ReadingLink[]]>(sql, bindings),
        catch: (cause) => new LinkRepositoryError({ cause }),
      }).pipe(Effect.map(([items]) => items));

    return LinkRepository.of({
      list: (owner, read, offset, limit) =>
        query(
          'SELECT key, url, title, createdAt, read FROM reading_link WHERE owner = $owner AND read = $read ORDER BY createdAt DESC, key DESC LIMIT $limit START $offset;',
          { owner, read, offset, limit }
        ),
      insert: (owner, item) =>
        Effect.suspend(() => {
          const key = createHash('sha256')
            .update(JSON.stringify([owner, item.url]))
            .digest('hex');

          return query(
            'UPSERT type::record("reading_link", $key) SET owner = $owner, url = $url, title = $title, key = $key, createdAt = $createdAt, read = $read WHERE owner = NONE RETURN key, url, title, createdAt, read;',
            { owner, key, ...item }
          ).pipe(Effect.map((items) => items[0]));
        }),
      mark: (owner, key, read) =>
        query(
          'UPDATE reading_link SET read = $read WHERE owner = $owner AND key = $key RETURN AFTER;',
          { owner, key, read }
        ).pipe(Effect.map((items) => items.length > 0)),
      remove: (owner, key) =>
        query(
          'DELETE reading_link WHERE owner = $owner AND key = $key RETURN BEFORE;',
          { owner, key }
        ).pipe(Effect.map((items) => items.length > 0)),
    });
  })
);
