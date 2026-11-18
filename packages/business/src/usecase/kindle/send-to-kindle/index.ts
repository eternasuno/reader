import { Effect, Option } from 'effect';
import type { OwnerId } from '../../../entity/common/owner-id';
import type { FeedItemId } from '../../../entity/feed-item/feed-item';
import type { SavedPageId } from '../../../entity/saved-page/saved-page';
import type {
  KindleDelivery,
  SmtpPassword,
} from '../../../entity/setting/kindle';
import type { FeedRepositoryError } from '../../../error/feed';
import type { FeedItemRepositoryError } from '../../../error/feed-item';
import {
  type EpubBuilderError,
  KindleNotConfigured,
  type MailSenderError,
} from '../../../error/kindle';
import type { SavedPageRepositoryError } from '../../../error/saved-page';
import type { SettingRepositoryError } from '../../../error/setting';
import type { EpubBuilder } from '../../../port/epub-builder';
import { FeedItemRepository } from '../../../port/feed-item-repository';
import type { FeedRepository } from '../../../port/feed-repository';
import { MailSender } from '../../../port/mail-sender';
import { SavedPageRepository } from '../../../port/saved-page-repository';
import { SettingRepository } from '../../../port/setting-repository';
import type { FetchAndExtractPorts } from '../../common/fetch-and-extract';
import { collect } from './collect';
import { type BookPart, pack } from './pack';

/** Subject and file name of one mail, numbered when the send has several (KD-SEND-4, KD-SPLIT-2). */
const naming = (today: string, index: number, total: number) =>
  total === 1
    ? { subject: `留白 ${today}`, filename: `liubai-${today}.epub` }
    : {
        subject: `留白 ${today} (${index + 1}/${total})`,
        filename: `liubai-${today}-${index + 1}.epub`,
      };

/** One mail from the sender to the Kindle address with one book attached (KD-SEND-4). */
const mailBook = Effect.fnUntraced(function* (
  kindle: KindleDelivery,
  password: Option.Option<SmtpPassword>,
  name: { readonly subject: string; readonly filename: string },
  book: Uint8Array
) {
  const sender = yield* MailSender;

  yield* sender.send({
    server: {
      host: kindle.smtpHost,
      port: kindle.smtpPort,
      security: kindle.smtpSecurity,
      user: kindle.smtpUser,
      password,
    },
    from: kindle.senderEmail,
    to: kindle.kindleEmail,
    subject: name.subject,
    attachment: {
      filename: name.filename,
      contentType: 'application/epub+zip',
      content: book,
    },
  });
});

/** Marks one book's articles read, and only those (KD-SEND-3, KD-SPLIT-4). */
const markRead = Effect.fnUntraced(function* (owner: OwnerId, part: BookPart) {
  const items = yield* FeedItemRepository;
  const pages = yield* SavedPageRepository;
  const feedItemIds: Array<FeedItemId> = [];
  const savedPageIds: Array<SavedPageId> = [];

  for (const { ref } of part.articles) {
    if (ref.kind === 'feed-item') feedItemIds.push(ref.id);
    else savedPageIds.push(ref.id);
  }

  yield* items.markRead(owner, feedItemIds, true);
  yield* pages.markRead(owner, savedPageIds, true);
});

/**
 * Mails every unread article of one owner to their Kindle as EPUB books and
 * marks them read afterwards (KD-SEND). `today` is the server-local date of
 * the send as `YYYY-MM-DD`; the caller reads the clock (KD-SEND-4, KD-BOOK-1).
 * No saved delivery fails before anything is read (KD-SEND-1); nothing unread
 * sends no mail and answers 0 (KD-SEND-2). A book too large is split
 * (KD-SPLIT); the books go one mail each, in order, and each book's articles
 * are marked read once its mail is accepted, so a failure keeps that book and
 * the ones after it unread (KD-SEND-3, KD-SPLIT-4).
 */
export const sendToKindle = Effect.fn('sendToKindle')(function* (
  owner: OwnerId,
  today: string
): Effect.fn.Return<
  { readonly count: number },
  SendToKindleError,
  SendToKindlePorts
> {
  const settings = yield* SettingRepository;
  const setting = yield* settings.get(owner);

  if (Option.isNone(setting.kindle)) {
    return yield* new KindleNotConfigured();
  }

  const articles = yield* collect(owner);

  if (articles.length === 0) {
    return { count: 0 };
  }

  const parts = yield* pack(`留白 ${today}`, articles);

  for (const [index, part] of parts.entries()) {
    yield* mailBook(
      setting.kindle.value,
      setting.smtpPassword,
      naming(today, index, parts.length),
      part.bytes
    );
    yield* markRead(owner, part);
  }

  return { count: articles.length };
});

/** The failures of one send (KD-SEND-1, KD-SEND-5, KD-SEND-6). */
export type SendToKindleError =
  | KindleNotConfigured
  | EpubBuilderError
  | MailSenderError
  | SettingRepositoryError
  | FeedRepositoryError
  | FeedItemRepositoryError
  | SavedPageRepositoryError;

/** The ports one send runs on (KD-SEND, KD-TEXT-3). */
export type SendToKindlePorts =
  | SettingRepository
  | FeedRepository
  | FeedItemRepository
  | SavedPageRepository
  | EpubBuilder
  | MailSender
  | FetchAndExtractPorts;
