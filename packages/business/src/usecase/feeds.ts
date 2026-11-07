import { DateTime, Effect, Option } from 'effect';
import type { Feed, FeedId } from '../entity/feed/feed';
import type { NormalizedUrl } from '../entity/object-value/normalized-url';
import type { OwnerId } from '../entity/object-value/owner-id';
import { FeedFetcher } from '../port/feed-fetcher';
import { FeedItemRepository } from '../port/feed-item-repository';
import { FeedParser } from '../port/feed-parser';
import { FeedRepository } from '../port/feed-repository';
import { SettingsRepository } from '../port/settings-repository';
import { FeedExists, FeedNotFound } from './feed-errors';
import {
  importFeedItems,
  initialSelection,
  refreshSelection,
} from './feed-selection';
import { feedId } from './identity';

const existsError = (id: FeedId) =>
  new FeedExists({ message: 'Feed already exists', id });

export const addFeed = (ownerId: OwnerId, url: NormalizedUrl) =>
  Effect.gen(function* () {
    const id = feedId(ownerId, url);
    const feeds = yield* FeedRepository;
    if (Option.isSome(yield* feeds.find(ownerId, id))) {
      return yield* existsError(id);
    }

    const feedFetcher = yield* FeedFetcher;
    const feedParser = yield* FeedParser;
    const document = yield* feedFetcher.fetch(url);
    const parsed = yield* feedParser.parse(document.content, document.url);
    const now = yield* DateTime.now;
    const feed: Feed = {
      id,
      ownerId,
      url,
      title: parsed.title,
      updatedAt: now,
    };
    if (!(yield* feeds.create(ownerId, [feed])).includes(id)) {
      return yield* existsError(id);
    }

    yield* importFeedItems(id, initialSelection(id, parsed.items));

    return feed;
  });

const readRetention = (ownerId: OwnerId) =>
  Effect.gen(function* () {
    const settings = yield* SettingsRepository;
    const value = yield* settings.get(ownerId);

    return value.feed.retention;
  });

export const refreshFeed = (ownerId: OwnerId, id: FeedId) =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const existing = yield* feeds.find(ownerId, id);
    if (Option.isNone(existing)) {
      return yield* new FeedNotFound({
        message: 'Feed not found',
        id,
      });
    }

    const feedFetcher = yield* FeedFetcher;
    const feedParser = yield* FeedParser;
    const document = yield* feedFetcher.fetch(existing.value.url);
    const parsed = yield* feedParser.parse(document.content, document.url);
    const now = yield* DateTime.now;
    const feedItems = yield* FeedItemRepository;
    const inventory = yield* feedItems.inventory(id);
    const retention = yield* readRetention(ownerId);
    const retained = refreshSelection(id, inventory, parsed.items).slice(
      0,
      retention
    );
    const feedPatch = { title: parsed.title, updatedAt: now };

    yield* importFeedItems(id, retained).pipe(
      Effect.andThen(
        feedItems.retain(
          id,
          retained.map((candidate) => candidate.id)
        )
      ),
      Effect.andThen(feeds.update(ownerId, [{ id, feedPatch }]))
    );

    return { ...existing.value, ...feedPatch };
  });
