import { Data, DateTime, Effect, Option } from 'effect';
import type { Feed } from '../entity/feed';
import type { FeedId, NormalizedUrl, OwnerId } from '../entity/object-value';
import { ArticleRepository } from '../port/article-repository';
import { FeedFetcher } from '../port/feed-fetcher';
import { FeedParser } from '../port/feed-parser';
import { FeedRepository } from '../port/feed-repository';
import { SettingsRepository } from '../port/settings-repository';
import {
  importArticles,
  initialSelection,
  refreshSelection,
} from './feed-selection';
import { feedId } from './identity';

export class FeedUrlInvalid extends Data.TaggedError('FeedUrlInvalid')<{
  readonly message: string;
}> {}

export class FeedExists extends Data.TaggedError('FeedExists')<{
  readonly message: string;
  readonly id: FeedId;
}> {}

export class FeedNotFound extends Data.TaggedError('FeedNotFound')<{
  readonly message: string;
  readonly id: FeedId;
}> {}

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

    yield* importArticles(
      ownerId,
      id,
      initialSelection(ownerId, id, parsed.articles)
    );

    return feed;
  });

const readRetention = (ownerId: OwnerId) =>
  Effect.gen(function* () {
    const settings = yield* SettingsRepository;
    const value = yield* settings.get(ownerId);

    return value.retention;
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
    const articles = yield* ArticleRepository;
    const inventory = yield* articles.inventory(ownerId, id);
    const retention = yield* readRetention(ownerId);
    const retained = refreshSelection(
      ownerId,
      id,
      inventory,
      parsed.articles
    ).slice(0, retention);
    const feedPatch = { title: parsed.title, updatedAt: now };

    yield* importArticles(ownerId, id, retained).pipe(
      Effect.andThen(
        articles.retain(
          ownerId,
          id,
          retained.map((candidate) => candidate.id)
        )
      ),
      Effect.andThen(feeds.update(ownerId, [{ id, feedPatch }]))
    );

    return { ...existing.value, ...feedPatch };
  });
