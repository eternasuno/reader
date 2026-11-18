import { DateTime, Effect } from 'effect';
import { EpubBuilder } from '../../../port/epub-builder';
import type { BookArticle } from './collect';

/**
 * The largest EPUB one mail carries: 20 MiB, about 27 MiB once base64-encoded
 * in the mail, which common SMTP providers accept (KD-SPLIT-1).
 */
export const MAX_BOOK_BYTES = 20 * 1024 * 1024;

/** One book of a send and the articles it holds (KD-SPLIT). */
export type BookPart = {
  readonly articles: ReadonlyArray<BookArticle>;
  readonly bytes: Uint8Array;
};

const halves = (
  articles: ReadonlyArray<BookArticle>
): ReadonlyArray<ReadonlyArray<BookArticle>> => {
  const middle = Math.ceil(articles.length / 2);

  return [articles.slice(0, middle), articles.slice(middle)];
};

const build = Effect.fnUntraced(function* (
  title: string,
  articles: ReadonlyArray<BookArticle>,
  images: boolean
) {
  const builder = yield* EpubBuilder;
  const createdAt = yield* DateTime.now;

  return yield* builder.build({
    title,
    createdAt,
    chapters: articles.map((article) => article.chapter),
    images,
  });
});

/**
 * Builds the books of one send (KD-SPLIT): one book when it fits; otherwise
 * the articles are halved in book order until every book fits, the books
 * numbered `(1)`, `(2)`, … in that order (KD-SPLIT-2). A single article too
 * large with its images is built without them, and sent as it then is
 * (KD-SPLIT-3).
 */
export const pack = Effect.fnUntraced(function* (
  title: string,
  articles: ReadonlyArray<BookArticle>
) {
  const whole = yield* build(title, articles, true);

  if (whole.length <= MAX_BOOK_BYTES) {
    return [{ articles, bytes: whole }];
  }

  if (articles.length === 1) {
    return [{ articles, bytes: yield* build(title, articles, false) }];
  }

  const parts: Array<BookPart> = [];
  const pending = [...halves(articles)];

  for (let group = pending.shift(); group; group = pending.shift()) {
    const numbered = `${title} (${parts.length + 1})`;
    const bytes = yield* build(numbered, group, true);

    if (bytes.length <= MAX_BOOK_BYTES) {
      parts.push({ articles: group, bytes });
    } else if (group.length === 1) {
      parts.push({
        articles: group,
        bytes: yield* build(numbered, group, false),
      });
    } else {
      pending.unshift(...halves(group));
    }
  }

  return parts;
});
