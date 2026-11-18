import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Redacted } from 'effect';
import { ArticleContent } from '../../../src/entity/common/article';
import { MailSenderError } from '../../../src/error/kindle';
import type { Ebook } from '../../../src/port/epub-builder';
import type { OutgoingMail } from '../../../src/port/mail-sender';
import { sendToKindle } from '../../../src/usecase/kindle/send-to-kindle';
import {
  alice,
  decodeEmailAddress,
  decodeSmtpPort,
  decodeSmtpUser,
  rowAt,
} from '../../support/fixtures';
import {
  captureBooks,
  captureMails,
  readFlags,
  runKindle,
  saveKindle,
  storedItemRows,
  storedPageRows,
  storeFeed,
  storeItems,
  storePage,
} from './harness';

const today = '2026-03-01';

const content = Option.some(ArticleContent.make('<p>Body</p>'));

/** Every field of the one mail a send writes (KD-SEND-4). */
const expectMail = (mail: OutgoingMail): void => {
  expect(mail.to).toBe('kindle@example.com');
  expect(mail.from).toBe('sender@example.com');
  expect(mail.subject).toBe(`留白 ${today}`);
  expect(mail.attachment.filename).toBe(`liubai-${today}.epub`);
  expect(mail.attachment.contentType).toBe('application/epub+zip');
  expect(mail.attachment.content).toStrictEqual(new Uint8Array([1, 2, 3]));
  expect(mail.server.host).toBe('smtp.example.com');
  expect(mail.server.port).toBe(587);
  expect(mail.server.security).toBe('starttls');
  expect(mail.server.user).toStrictEqual(Option.some('login'));
  expect(Redacted.value(Option.getOrThrow(mail.server.password))).toBe(
    'smtp-secret'
  );
};

const delivery = {
  senderEmail: decodeEmailAddress('sender@example.com'),
  smtpPort: decodeSmtpPort(587),
  smtpSecurity: 'starttls' as const,
  smtpUser: Option.some(decodeSmtpUser('login')),
};

describe('sendToKindle without a delivery', () => {
  it.effect(
    'KD-SEND-1 fails before reading, building or marking anything',
    () => {
      const books: Array<Ebook> = [];
      const mails: Array<OutgoingMail> = [];

      return runKindle(
        Effect.gen(function* () {
          const feed = yield* storeFeed();

          yield* storeItems(feed, 1);

          const error = yield* sendToKindle(alice, today).pipe(Effect.flip);

          expect(error._tag).toBe('KindleNotConfigured');
          expect(books).toEqual([]);
          expect(mails).toEqual([]);
          expect(readFlags(yield* storedItemRows())).toEqual([false]);
        }),
        { build: captureBooks(books), send: captureMails(mails) }
      );
    }
  );
});

describe('sendToKindle with nothing unread', () => {
  it.effect('KD-SEND-2 answers 0 and sends no mail', () => {
    const books: Array<Ebook> = [];
    const mails: Array<OutgoingMail> = [];

    return runKindle(
      Effect.gen(function* () {
        yield* saveKindle();

        const feed = yield* storeFeed();

        yield* storeItems(feed, 1, { read: true });
        yield* storePage({ read: true });

        expect(yield* sendToKindle(alice, today)).toEqual({ count: 0 });
        expect(books).toEqual([]);
        expect(mails).toEqual([]);
      }),
      { build: captureBooks(books), send: captureMails(mails) }
    );
  });
});

describe('sendToKindle', () => {
  it.effect('Scenario: Sending the unread articles', () => {
    const books: Array<Ebook> = [];
    const mails: Array<OutgoingMail> = [];

    return runKindle(
      Effect.gen(function* () {
        yield* saveKindle(delivery);

        const feed = yield* storeFeed();
        const unread = yield* storeItems(feed, 2, { content });
        const page = yield* storePage();

        yield* storeItems(feed, 1, { read: true });

        expect(yield* sendToKindle(alice, today)).toEqual({ count: 3 });

        const chapters = rowAt(books, 0).chapters;

        expect(books).toHaveLength(1);
        expect(mails).toHaveLength(1);
        expect(chapters.map((chapter) => chapter.url.href)).toEqual([
          page.url.href,
          rowAt(unread, 0).url.href,
          rowAt(unread, 1).url.href,
        ]);
        expect(rowAt(chapters, 0).source).toBe('稍后阅读');
        expectMail(rowAt(mails, 0));
        expect(readFlags(yield* storedItemRows())).toEqual([true, true, true]);
        expect(readFlags(yield* storedPageRows())).toEqual([true]);
      }),
      { build: captureBooks(books), send: captureMails(mails) }
    );
  });

  it.effect(
    'KD-SEND-4 sends no login when no user or no password is saved',
    () => {
      const mails: Array<OutgoingMail> = [];

      return runKindle(
        Effect.gen(function* () {
          yield* saveKindle({}, Option.none());

          const feed = yield* storeFeed();

          yield* storeItems(feed, 1);
          yield* sendToKindle(alice, today);

          const mail = rowAt(mails, 0);

          expect(mail.server.user).toStrictEqual(Option.none());
          expect(mail.server.password).toStrictEqual(Option.none());
        }),
        { send: captureMails(mails) }
      );
    }
  );
});

describe('sendToKindle failures', () => {
  it.effect(
    'KD-SEND-3 a failed mail fails the send and marks nothing read',
    () =>
      runKindle(
        Effect.gen(function* () {
          yield* saveKindle();

          const feed = yield* storeFeed();

          yield* storeItems(feed, 2);
          yield* storePage();

          const error = yield* sendToKindle(alice, today).pipe(Effect.flip);

          expect(error._tag).toBe('MailSenderError');
          expect(readFlags(yield* storedItemRows())).toEqual([false, false]);
          expect(readFlags(yield* storedPageRows())).toEqual([false]);
        }),
        {
          send: () =>
            Effect.fail(new MailSenderError({ message: 'login refused' })),
        }
      )
  );
});
