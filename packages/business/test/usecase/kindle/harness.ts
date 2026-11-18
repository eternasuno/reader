import { type DateTime, Effect, Layer, Option } from 'effect';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import type { Feed } from '../../../src/entity/feed/feed';
import type { FeedItem } from '../../../src/entity/feed-item/feed-item';
import type { SavedPage } from '../../../src/entity/saved-page/saved-page';
import type { FeedRepositoryError } from '../../../src/error/feed';
import type { FeedItemRepositoryError } from '../../../src/error/feed-item';
import type { SavedPageRepositoryError } from '../../../src/error/saved-page';
import type { SettingRepositoryError } from '../../../src/error/setting';
import type { Ebook, IEpubBuilder } from '../../../src/port/epub-builder';
import { EpubBuilder } from '../../../src/port/epub-builder';
import { FeedItemRepository } from '../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../src/port/feed-repository';
import type { IMailSender, OutgoingMail } from '../../../src/port/mail-sender';
import { MailSender } from '../../../src/port/mail-sender';
import { SavedPageRepository } from '../../../src/port/saved-page-repository';
import { SettingRepository } from '../../../src/port/setting-repository';
import type { SendToKindlePorts } from '../../../src/usecase/kindle/send-to-kindle';
import {
  alice,
  decodeSmtpPassword,
  type FeedItemOverrides,
  type FeedOverrides,
  itemRow,
  type KindleDeliveryOverrides,
  kindleDelivery,
  makeUniqueFeed,
  makeUniqueSavedPage,
  type SavedPageOverrides,
} from '../../support/fixtures';
import { MemoryFeedStoreLive } from '../../support/memory/feed-store';
import { memorySavedPageLayer } from '../../support/memory/saved-page';
import { memorySettingLayer } from '../../support/memory/setting';
import { type FetchDoubles, fetchLayers } from '../common/harness';

/** The bytes the mocked builder answers; the book itself is captured instead. */
const builtBytes = new Uint8Array([1, 2, 3]);

/** The doubles one send replaces; everything else succeeds. */
export type KindleDoubles = FetchDoubles & {
  readonly build?: IEpubBuilder['build'];
  readonly send?: IMailSender['send'];
};

/** Fresh stores per provide, so every test starts from no row (KD-SEND). */
export const kindleLayer = (
  doubles: KindleDoubles = {}
): Layer.Layer<SendToKindlePorts> =>
  Layer.mergeAll(
    MemoryFeedStoreLive,
    memorySavedPageLayer(),
    memorySettingLayer(),
    fetchLayers(doubles),
    Layer.mock(EpubBuilder, {
      build: doubles.build ?? (() => Effect.succeed(builtBytes)),
    }),
    Layer.mock(MailSender, { send: doubles.send ?? (() => Effect.void) })
  );

export const runKindle = <A, E>(
  effect: Effect.Effect<A, E, SendToKindlePorts>,
  doubles: KindleDoubles = {}
): Effect.Effect<A, E> => effect.pipe(Effect.provide(kindleLayer(doubles)));

/** Saves the Kindle delivery of one owner, with a password unless none is given (SET-KINDLE-3). */
export const saveKindle = (
  overrides: KindleDeliveryOverrides = {},
  password: Option.Option<string> = Option.some('smtp-secret'),
  owner: OwnerId = alice,
  nextSendAt: Option.Option<DateTime.Utc> = Option.none()
): Effect.Effect<void, SettingRepositoryError, SettingRepository> =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;

    yield* settings.setKindle(
      owner,
      kindleDelivery(overrides),
      Option.map(password, decodeSmtpPassword),
      nextSendAt
    );
  });

/**
 * One stored feed of the owner, so its items have a feed to belong to (FD-ID-1).
 * It lists oldest first unless told otherwise, so the book follows storage
 * order; the KD-BOOK-2 test sets both orders explicitly.
 */
export const storeFeed = (
  overrides: FeedOverrides = {}
): Effect.Effect<Feed, FeedRepositoryError, FeedRepository> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = makeUniqueFeed({
      ownerId: alice,
      order: 'oldest',
      ...overrides,
    });

    yield* feeds.create(alice, [feed]);

    return feed;
  });

/** `count` stored items of one feed in creation order, so ids ascend (FD-ID-2). */
export const storeItems = (
  feed: Feed,
  count: number,
  overrides: FeedItemOverrides = {}
): Effect.Effect<
  ReadonlyArray<FeedItem>,
  FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const rows = Array.from({ length: count }, () =>
      itemRow(feed.id, overrides)
    );

    yield* items.create(alice, rows);

    return rows;
  });

/** One stored saved page of the owner (SP-ADD). */
export const storePage = (
  overrides: SavedPageOverrides = {}
): Effect.Effect<SavedPage, SavedPageRepositoryError, SavedPageRepository> =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;
    const page = makeUniqueSavedPage({ ownerId: alice, ...overrides });

    yield* pages.create(alice, [page]);

    return page;
  });

const everything = {
  limit: Number.MAX_SAFE_INTEGER,
  unread: false,
  cursor: Option.none(),
};

/** Every stored item of the owner as it is now, ids descending (CM-PAGE-1). */
export const storedItemRows = (
  owner: OwnerId = alice
): Effect.Effect<
  ReadonlyArray<FeedItem>,
  FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;

    return yield* items.listAll(owner, everything);
  });

/** Every stored page of the owner as it is now, ids descending (SP-LIST-1). */
export const storedPageRows = (
  owner: OwnerId = alice
): Effect.Effect<
  ReadonlyArray<SavedPage>,
  SavedPageRepositoryError,
  SavedPageRepository
> =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;

    return yield* pages.list(owner, everything);
  });

/** Captures the books one send builds, in order (KD-BOOK-1). */
export const captureBooks =
  (books: Array<Ebook>): IEpubBuilder['build'] =>
  (book) => {
    books.push(book);

    return Effect.succeed(builtBytes);
  };

/** Captures the mails one send sends, in order (KD-SEND-4). */
export const captureMails =
  (mails: Array<OutgoingMail>): IMailSender['send'] =>
  (mail) => {
    mails.push(mail);

    return Effect.void;
  };

/** The read flag of each row, in the order the list returned them (FD-READ). */
export const readFlags = (
  rows: ReadonlyArray<{ readonly read: boolean }>
): ReadonlyArray<boolean> => rows.map((row) => row.read);
