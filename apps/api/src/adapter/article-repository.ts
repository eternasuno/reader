import { createHash } from 'node:crypto';
import {
  type ArticleContent,
  ArticleRepository,
  ArticleRepositoryError,
  type ArticleSource,
} from '@reader/business';
import { Effect, Layer } from 'effect';
import { Database } from '../infrastructure/db';

export const ArticleRepositoryLive = Layer.effect(
  ArticleRepository,
  Effect.gen(function* () {
    const db = yield* Database;
    const query = <A>(sql: string, bindings: Record<string, unknown>) =>
      Effect.tryPromise({
        try: () => db.query<[A]>(sql, bindings),
        catch: () => new ArticleRepositoryError({ error: '无法访问文章内容' }),
      }).pipe(Effect.map(([result]) => result));

    return ArticleRepository.of({
      metadata: (owner, kind, key) =>
        query<ArticleSource[]>(
          kind === 'link'
            ? 'SELECT title, url, read FROM reading_link WHERE owner = $owner AND key = $key;'
            : 'SELECT title, url, read, description, feedKey FROM feed_article WHERE owner = $owner AND key = $key;',
          { owner, key }
        ).pipe(Effect.map((items) => items[0])),
      get: (owner, url) =>
        query<ArticleContent[]>(
          'SELECT url, title, html, extractedAt FROM article_content WHERE owner = $owner AND url = $url;',
          { owner, url }
        ).pipe(Effect.map((items) => items[0])),
      save: (owner, article) =>
        Effect.suspend(() =>
          query(
            'UPSERT type::record("article_content", $id) SET owner = $owner, url = $url, title = $title, html = $html, extractedAt = $extractedAt;',
            {
              owner,
              ...article,
              id: createHash('sha256')
                .update(JSON.stringify([owner, article.url]))
                .digest('hex'),
            }
          ).pipe(Effect.asVoid)
        ),
    });
  })
);
