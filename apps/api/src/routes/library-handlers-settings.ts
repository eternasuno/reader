import {
  SettingRepository,
  setFetcher as setFetcherUseCase,
} from '@reader/business';
import { Effect, Option } from 'effect';
import { type HandlerRequest, withSession } from './library-contract';
import {
  fetcherFailure,
  retentionFailure,
  settingRepositoryFailure,
} from './library-failures';
import { decodeFetcherInput, decodeRetention } from './library-input';

const settings = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;
      const setting = yield* repository.get(owner);

      return {
        retention: setting.feed.retention,
        provider: setting.fetcher.provider,
        jinaKeyConfigured: Option.isSome(setting.fetcher.jina.key),
        browserEndpointConfigured: Option.isSome(
          setting.fetcher.browser.endpoint
        ),
      };
    })
  ).pipe(Effect.catchTags(settingRepositoryFailure));

const setRetention = ({ payload }: HandlerRequest<'setRetention'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const retention = yield* decodeRetention(payload.retention);
      const repository = yield* SettingRepository;
      yield* repository.update(owner, { feed: { retention } });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(retentionFailure));

const setFetcher = ({ payload }: HandlerRequest<'setFetcher'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const input = yield* decodeFetcherInput(payload);
      yield* setFetcherUseCase(owner, input);

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(fetcherFailure));

const deleteKey = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;
      yield* repository.update(owner, {
        fetcher: { jina: { key: Option.none() } },
      });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(settingRepositoryFailure));

export const settingsHandlers = {
  settings,
  setRetention,
  setFetcher,
  deleteKey,
};
