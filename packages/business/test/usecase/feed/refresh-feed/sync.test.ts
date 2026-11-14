import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Option } from 'effect';
import { HttpClient } from 'effect/http';
import { Retention } from '../../../../src/entity/setting/retention';
import { DocumentSanitizer } from '../../../../src/port/document-sanitizer';
import {
  FeedItemRepositoryError,
  type IFeedItemRepository,
} from '../../../../src/port/feed-item-repository';
import { FeedParser } from '../../../../src/port/feed-parser';
import { HtmlParser } from '../../../../src/port/html-parser';
import { SettingRepository } from '../../../../src/port/setting-repository';
import { refreshFeed } from '../../../../src/usecase/feed/refresh-feed';
import {
  alice,
  decodeUrl,
  makeFeedItem,
  makeUniqueFeed,
} from '../../../support/fixtures';
import { memoryFeedStoreLayer } from '../../../support/memory/feed-store';
import { MemorySettingRepositoryLive } from '../../../support/memory/setting';
import {
  defaultParseHtml,
  defaultSanitize,
  feedResponse,
  findFeed,
  parsedEntry,
  parsedFeed,
  storedItems,
  storeFeed,
  storeItems,
  urlsOf,
} from '../../../support/usecase/feed';

const base = 'https://example.com';

const urls = Array.from({ length: 31 }, (_, index) => `${base}/item/${index}`);

const parsed = parsedFeed({
  title: 'Source title',
  entries: urls.slice(1).map((url) => parsedEntry(url)),
});

type RemoveSwitch = { fail: boolean };

const failingRemove =
  (switching: RemoveSwitch) =>
  (items: IFeedItemRepository): IFeedItemRepository => ({
    ...items,
    remove: (owner, ids) =>
      switching.fail
        ? Effect.fail(new FeedItemRepositoryError({ message: 'remove' }))
        : items.remove(owner, ids),
  });

const syncLayer = (switching: RemoveSwitch) =>
  Layer.mergeAll(
    memoryFeedStoreLayer(failingRemove(switching)),
    MemorySettingRepositoryLive,
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((_request, url) =>
        Effect.succeed(feedResponse({ url: url.href }))
      )
    ),
    Layer.mock(FeedParser, { parse: () => Effect.succeed(parsed) }),
    Layer.mock(HtmlParser, { parse: defaultParseHtml }),
    Layer.mock(DocumentSanitizer, { sanitize: defaultSanitize })
  );

const feedOf = () => makeUniqueFeed({ ownerId: alice });

const storedRows = (feedId: ReturnType<typeof feedOf>['id'], count: number) =>
  [...urls.slice(0, count)]
    .reverse()
    .map((url) =>
      makeFeedItem({ ownerId: alice, feedId, url: decodeUrl(url) })
    );

describe('refreshFeed non-atomic sync', () => {
  it.effect(
    'FD-SYNC-2 a failure between the writes leaves them and the next sync converges',
    () =>
      Effect.gen(function* () {
        const switching: RemoveSwitch = { fail: true };
        const feed = feedOf();

        const result = yield* Effect.gen(function* () {
          const settings = yield* SettingRepository;

          yield* storeFeed(feed);
          yield* storeItems(alice, storedRows(feed.id, 30));
          yield* settings.setRetention(alice, Retention.make(30));

          const error = yield* refreshFeed(alice, feed.id).pipe(Effect.flip);
          const partial = yield* storedItems(alice, feed.id);
          const failed = yield* findFeed(alice, feed.id);

          switching.fail = false;
          yield* refreshFeed(alice, feed.id);

          return {
            error,
            partial: urlsOf(partial),
            failed: Option.getOrThrow(failed),
            converged: urlsOf(yield* storedItems(alice, feed.id)),
            convergedFeed: Option.getOrThrow(yield* findFeed(alice, feed.id)),
          };
        }).pipe(Effect.provide(syncLayer(switching)));

        expect(result.error).toStrictEqual(
          new FeedItemRepositoryError({ message: 'remove' })
        );
        expect(result.partial).toHaveLength(31);
        expect(result.partial.filter((url) => url === urls[30])).toHaveLength(
          1
        );
        expect(result.failed).toStrictEqual(feed);
        expect(result.failed.title).toBe(feed.title);

        expect(result.converged).toHaveLength(30);
        expect(new Set(result.converged).size).toBe(30);
        expect([...result.converged].sort()).toEqual([...urls.slice(1)].sort());
        expect(result.convergedFeed.title).toBe('Source title');
        expect(Option.isSome(result.convergedFeed.updatedAt)).toBe(true);
      })
  );
});
