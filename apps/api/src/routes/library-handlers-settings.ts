import { Effect, Option } from 'effect';
import { SettingsRepository } from '../../../../packages/business/src/port/settings-repository.ts';
import {
  getSettings,
  updateExtraction,
  updateRetention,
} from '../../../../packages/business/src/usecase/settings.ts';
import { type HandlerRequest, withSession } from './library-contract';
import {
  extractionFailure,
  retentionFailure,
  settingsReadFailure,
  settingsRepositoryFailure,
} from './library-failures';

const settings = () =>
  withSession((owner) => getSettings(owner)).pipe(
    Effect.catchTags(settingsReadFailure)
  );

const setRetention = ({ payload }: HandlerRequest<'setRetention'>) =>
  withSession((owner) => updateRetention(owner, payload.retention)).pipe(
    Effect.catchTags(retentionFailure)
  );

const setExtraction = ({ payload }: HandlerRequest<'setExtraction'>) =>
  withSession((owner) =>
    updateExtraction(owner, {
      provider: payload.provider,
      ...Option.match(payload.jinaKey, {
        onNone: () => ({}),
        onSome: (jinaKey) => ({ jinaKey }),
      }),
      ...Option.match(payload.browserEndpoint, {
        onNone: () => ({}),
        onSome: (browserEndpoint) => ({ browserEndpoint }),
      }),
    })
  ).pipe(Effect.catchTags(extractionFailure));

const deleteKey = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const extractionSettings = yield* SettingsRepository;
      yield* extractionSettings.clearKey(owner);

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(settingsRepositoryFailure));

const deleteBrowser = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const extractionSettings = yield* SettingsRepository;
      yield* extractionSettings.clearBrowser(owner);

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(settingsRepositoryFailure));

export const settingsHandlers = {
  settings,
  setRetention,
  setExtraction,
  deleteKey,
  deleteBrowser,
};
