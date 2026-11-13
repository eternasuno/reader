import {
  FeedRepository,
  makeFeedTitle,
  moveFeed,
  previewFeed,
  subscribeFeed,
} from '@reader/business';
import { Effect, Option } from 'effect';
import { FeedRefreshQueue } from '../../refresh/queue';
import {
  feedRepositoryFailure,
  moveFeedFailure,
  previewFailure,
  subscribeFailure,
} from './failures';
import { decodeFeedUrl } from './input';
import { type HandlerRequest, handle, handleOk } from './session';

const feeds = () =>
  handle(feedRepositoryFailure, (owner) =>
    Effect.flatMap(FeedRepository, (repository) =>
      Effect.map(repository.list(owner), (items) => ({ items }))
    )
  );

const descriptionOf = (description: Option.Option<string>) =>
  Option.match(description, {
    onNone: () => ({}),
    onSome: (value) => ({ description: value }),
  });

const preview = ({ payload }: HandlerRequest<'preview'>) =>
  handle(previewFailure, () =>
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
  );

const subscribe = ({ payload }: HandlerRequest<'subscribe'>) =>
  handle(subscribeFailure, (owner) =>
    Effect.gen(function* () {
      const url = yield* decodeFeedUrl(payload.url);
      const item = yield* subscribeFeed(
        owner,
        url,
        makeFeedTitle(payload.title ?? '', url),
        Option.fromUndefinedOr(payload.folderId)
      );
      const queue = yield* FeedRefreshQueue;
      yield* queue.enqueue(owner, item.id);

      return { item };
    })
  );

const unsubscribe = ({ payload }: HandlerRequest<'unsubscribe'>) =>
  handleOk(feedRepositoryFailure, (owner) =>
    Effect.flatMap(FeedRepository, (repository) =>
      repository.remove(owner, [payload.id])
    )
  );

const move = ({ payload }: HandlerRequest<'moveFeed'>) =>
  handleOk(moveFeedFailure, (owner) =>
    moveFeed(owner, payload.id, Option.fromNullishOr(payload.folderId))
  );

export const feedHandlers = {
  feeds,
  preview,
  subscribe,
  unsubscribe,
  moveFeed: move,
};
