import { Effect } from 'effect';
import { SettingsRepository } from '../../../../packages/business/src/port/settings-repository.ts';
import {
  getSettings,
  updateExtraction,
  updateRetention,
} from '../../../../packages/business/src/usecase/settings.ts';
import { type HandlerRequest, withSession } from './library-contract';
import {
  extractionFailure,
  extractionWriteFailure,
  retentionFailure,
  settingsReadFailure,
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
      ...(payload.jinaKey === undefined ? {} : { jinaKey: payload.jinaKey }),
      ...(payload.browserEndpoint === undefined
        ? {}
        : { browserEndpoint: payload.browserEndpoint }),
    })
  ).pipe(Effect.catchTags(extractionFailure));

const deleteKey = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const extractionSettings = yield* SettingsRepository;
      yield* extractionSettings.clearKey(owner);

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(extractionWriteFailure));

const deleteBrowser = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const extractionSettings = yield* SettingsRepository;
      yield* extractionSettings.clearBrowser(owner);

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(extractionWriteFailure));

export const settingsHandlers = {
  settings,
  setRetention,
  setExtraction,
  deleteKey,
  deleteBrowser,
};
