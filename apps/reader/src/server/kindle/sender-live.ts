import {
  type ArticleExtractor,
  type FeedItemRepository,
  type FeedRepository,
  type HtmlParser,
  type OwnerId,
  type SavedPageRepository,
  type SettingRepository,
  sendToKindle,
} from '@reader/business';
import { EpubBuilderLive } from '@reader/epub';
import { MailSenderLive } from '@reader/mail';
import { DateTime, Effect, Layer } from 'effect';
import type { HttpClient } from 'effect/http';
import { webpageFetcherFor } from '../http/fetcher';
import { localDate } from './local-time';
import { KindleSender, KindleSendInProgress } from './sender';

/**
 * What one send reads from the environment: the repositories, the extraction
 * ports and one HTTP client (KD-SEND, KD-TEXT-3).
 */
export type KindleSenderEnvironment =
  | SettingRepository
  | FeedRepository
  | FeedItemRepository
  | SavedPageRepository
  | HtmlParser
  | ArticleExtractor
  | HttpClient.HttpClient;

/**
 * The adapters one send runs on: the EPUB builder, the SMTP mail and the
 * owner's own fetcher (KD-BOOK, KD-SEND-4, KD-TEXT-3).
 */
const sendPorts = (owner: OwnerId) =>
  Layer.mergeAll(EpubBuilderLive, MailSenderLive, webpageFetcherFor(owner));

/**
 * One send per owner at a time (KD-SEND-7): a second request while that
 * owner's send runs fails with `KindleSendInProgress` and starts nothing, and
 * the owner is released however its send ends, so a later send runs again.
 */
export const KindleSenderLive: Layer.Layer<
  KindleSender,
  never,
  KindleSenderEnvironment
> = Layer.effect(
  KindleSender,
  Effect.gen(function* () {
    const context = yield* Effect.context<KindleSenderEnvironment>();
    const running = new Set<OwnerId>();

    const run = Effect.fnUntraced(function* (owner: OwnerId) {
      const today = yield* Effect.map(DateTime.now, (now) =>
        localDate(DateTime.toEpochMillis(now))
      );

      return yield* sendToKindle(owner, today).pipe(
        Effect.provide(sendPorts(owner)),
        Effect.provideContext(context)
      );
    });

    const send = Effect.fnUntraced(function* (owner: OwnerId) {
      if (running.has(owner)) {
        return yield* new KindleSendInProgress();
      }

      running.add(owner);

      return yield* Effect.ensuring(
        run(owner),
        Effect.sync(() => {
          running.delete(owner);
        })
      );
    });

    return KindleSender.of({ send });
  })
);
