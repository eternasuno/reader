import { describe, expect, it } from '@effect/vitest';
import { Effect, Exit, Option } from 'effect';
import { ArticleContent } from '../../../src/entity/common/article';
import { MailSenderError } from '../../../src/error/kindle';
import type { Ebook, IEpubBuilder } from '../../../src/port/epub-builder';
import type { IMailSender, OutgoingMail } from '../../../src/port/mail-sender';
import { sendToKindle } from '../../../src/usecase/kindle/send-to-kindle';
import { MAX_BOOK_BYTES } from '../../../src/usecase/kindle/send-to-kindle/pack';
import { decodeTitle } from '../../support/fixtures';
import {
  captureMails,
  readFlags,
  runKindle,
  saveKindle,
  storedItemRows,
  storeFeed,
  storeItems,
} from './harness';

const today = '2026-03-01';

const content = Option.some(ArticleContent.make('<p>Body</p>'));

const MIB = 1024 * 1024;

const chapterSize = (title: string, images: boolean): number => {
  if (title !== 'Huge') return 8 * MIB;

  return images ? 30 * MIB : 1024;
};

/**
 * A builder whose output grows with its chapters: 8 MiB each, so two fit in
 * one book and three do not; a chapter titled `Huge` weighs 30 MiB with its
 * images and 1 KiB without them.
 */
const sizedBuilder =
  (books: Array<Ebook>): IEpubBuilder['build'] =>
  (book) => {
    books.push(book);

    const size = book.chapters.reduce(
      (sum, chapter) => sum + chapterSize(chapter.title, book.images),
      0
    );

    return Effect.succeed(new Uint8Array(size));
  };

/** Three unread items of one feed, oldest first. */
const storeThree = Effect.gen(function* () {
  yield* saveKindle();
  const feed = yield* storeFeed();
  yield* storeItems(feed, 3, { content });

  return feed;
});

/** Two numbered mails and books, two articles then one (KD-SPLIT-2). */
const expectTwoParts = (
  books: ReadonlyArray<Ebook>,
  mails: ReadonlyArray<OutgoingMail>
): void => {
  expect(mails.map((mail) => mail.subject)).toStrictEqual([
    `留白 ${today} (1/2)`,
    `留白 ${today} (2/2)`,
  ]);
  expect(mails.map((mail) => mail.attachment.filename)).toStrictEqual([
    `liubai-${today}-1.epub`,
    `liubai-${today}-2.epub`,
  ]);
  expect(
    mails.every((mail) => mail.attachment.content.length <= MAX_BOOK_BYTES)
  ).toBe(true);
  expect(books.slice(1).map((book) => book.title)).toStrictEqual([
    `留白 ${today} (1)`,
    `留白 ${today} (2)`,
  ]);
  expect(books.slice(1).map((book) => book.chapters.length)).toStrictEqual([
    2, 1,
  ]);
};

const splitTwo = (books: Array<Ebook>, mails: Array<OutgoingMail>) =>
  runKindle(
    Effect.gen(function* () {
      const feed = yield* storeThree;

      expect(yield* sendToKindle(feed.ownerId, today)).toStrictEqual({
        count: 3,
      });
      expectTwoParts(books, mails);
      expect(readFlags(yield* storedItemRows())).toStrictEqual([
        true,
        true,
        true,
      ]);
    }),
    { build: sizedBuilder(books), send: captureMails(mails) }
  );

/** The first mail goes, the second is refused. */
const refuseSecond = (): IMailSender['send'] => {
  let sent = 0;

  return () => {
    sent += 1;

    return sent === 1
      ? Effect.void
      : Effect.fail(new MailSenderError({ message: 'refused' }));
  };
};

describe('a send larger than one mail', () => {
  it.effect('KD-SPLIT-2 splits the articles into numbered books in order', () =>
    splitTwo([], [])
  );

  it.effect(
    'KD-SPLIT-4 a failed mail keeps its book and the later ones unread',
    () =>
      runKindle(
        Effect.gen(function* () {
          const feed = yield* storeThree;
          const exit = yield* Effect.exit(sendToKindle(feed.ownerId, today));

          expect(Exit.isFailure(exit)).toBe(true);
          expect(readFlags(yield* storedItemRows())).toStrictEqual([
            false,
            true,
            true,
          ]);
        }),
        { build: sizedBuilder([]), send: refuseSecond() }
      )
  );

  it.effect(
    'KD-SPLIT-3 an article too large with its images goes as text',
    () => {
      const books: Array<Ebook> = [];
      const mails: Array<OutgoingMail> = [];

      return runKindle(
        Effect.gen(function* () {
          yield* saveKindle();
          const feed = yield* storeFeed();
          yield* storeItems(feed, 1, { title: decodeTitle('Huge'), content });
          yield* storeItems(feed, 1, { title: decodeTitle('Small'), content });

          yield* sendToKindle(feed.ownerId, today);

          const textOnly = books.filter((book) => !book.images);

          expect(mails).toHaveLength(2);
          expect(
            textOnly.map((book) => book.chapters.map((c) => c.title))
          ).toStrictEqual([['Huge']]);
          expect(books.at(-1)?.images).toBe(true);
        }),
        { build: sizedBuilder(books), send: captureMails(mails) }
      );
    }
  );
});
