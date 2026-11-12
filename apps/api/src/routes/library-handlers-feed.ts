import {
  FeedRepository,
  makeFeedTitle,
  previewFeed,
  subscribeFeed,
} from '@reader/business';
import { Effect, Option } from 'effect';
import { FeedRefreshQueue } from '../infrastructure/feed-refresh-queue';
import { type HandlerRequest, withSession } from './library-contract';
import {
  feedRepositoryFailure,
  previewFailure,
  subscribeFailure,
} from './library-failures';
import { decodeFeedUrl } from './library-input';

const feeds = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* FeedRepository;

      return { items: yield* repository.list(owner) };
    })
  ).pipe(Effect.catchTags(feedRepositoryFailure));

const descriptionOf = (description: Option.Option<string>) =>
  Option.match(description, {
    onNone: () => ({}),
    onSome: (value) => ({ description: value }),
  });

const preview = ({ payload }: HandlerRequest<'preview'>) =>
  withSession(() =>
    Effect.gen(function* () {
      const url = yield* decodeFeedUrl(payload.url);
      const result = yield* previewFeed(url);

      return {
        preview: {
          url: url.href,
          title: result.title,
          ...descriptionOf(result.description),
          titles: result.entryTitles,
        },
      };
    })
  ).pipe(Effect.catchTags(previewFailure));

const subscribe = ({ payload }: HandlerRequest<'subscribe'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const url = yield* decodeFeedUrl(payload.url);
      const item = yield* subscribeFeed(
        owner,
        url,
        makeFeedTitle(payload.title ?? '', url)
      );
      const queue = yield* FeedRefreshQueue;
      yield* queue.enqueue(owner, item.id);

      return { item };
    })
  ).pipe(Effect.catchTags(subscribeFailure));

const unsubscribe = ({ payload }: HandlerRequest<'unsubscribe'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* FeedRepository;
      yield* repository.remove(owner, [payload.id]);

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(feedRepositoryFailure));

export const feedHandlers = { feeds, preview, subscribe, unsubscribe };
