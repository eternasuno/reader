import { SettingRepository, useBrowser, useJina } from '@reader/business';
import { Effect, Option } from 'effect';
import {
  browserFetcherFailure,
  jinaFetcherFailure,
  retentionFailure,
  settingRepositoryFailure,
} from './failures';
import { decodeBrowserEndpoint, decodeJinaKey, decodeRetention } from './input';
import { type HandlerRequest, handle, handleOk } from './session';

const settings = () =>
  handle(settingRepositoryFailure, (owner) =>
    Effect.flatMap(SettingRepository, (repository) =>
      Effect.map(repository.get(owner), (setting) => ({
        retention: setting.feed.retention,
        provider: setting.fetcher.provider,
        jinaKeyConfigured: Option.isSome(setting.fetcher.jina.key),
        browserEndpointConfigured: Option.isSome(
          setting.fetcher.browser.endpoint
        ),
      }))
    )
  );

const setRetention = ({ payload }: HandlerRequest<'setRetention'>) =>
  handleOk(retentionFailure, (owner) =>
    Effect.flatMap(decodeRetention(payload.retention), (retention) =>
      Effect.flatMap(SettingRepository, (repository) =>
        repository.setRetention(owner, retention)
      )
    )
  );

const useJinaFetcher = ({ payload }: HandlerRequest<'useJinaFetcher'>) =>
  handleOk(jinaFetcherFailure, (owner) =>
    Effect.flatMap(decodeJinaKey(payload.key), (key) => useJina(owner, key))
  );

const useBrowserFetcher = ({ payload }: HandlerRequest<'useBrowserFetcher'>) =>
  handleOk(browserFetcherFailure, (owner) =>
    Effect.flatMap(decodeBrowserEndpoint(payload.endpoint), (endpoint) =>
      useBrowser(owner, endpoint)
    )
  );

const deleteKey = () =>
  handleOk(settingRepositoryFailure, (owner) =>
    Effect.flatMap(SettingRepository, (repository) =>
      repository.clearJinaKey(owner)
    )
  );

export const settingsHandlers = {
  settings,
  setRetention,
  useJinaFetcher,
  useBrowserFetcher,
  deleteKey,
};
