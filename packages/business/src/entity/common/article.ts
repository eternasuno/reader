import { Schema, SchemaTransformation } from 'effect';

export const ArticleTitle = Schema.Trim.pipe(
  Schema.decode(
    SchemaTransformation.transform({
      decode: (title) => title || 'Untitled',
      encode: (title) => title,
    })
  ),
  Schema.brand('ArticleTitle')
);

export type ArticleTitle = typeof ArticleTitle.Type;

export const ArticleDescription = Schema.Trim.pipe(
  Schema.brand('ArticleDescription')
);

export type ArticleDescription = typeof ArticleDescription.Type;

export const ArticleContent = Schema.Trim.pipe(Schema.brand('ArticleContent'));

export type ArticleContent = typeof ArticleContent.Type;
