import { Effect } from 'effect';
import type { OwnerId } from '../entity/object-value';
import type { Retention } from '../entity/setting';
import type { SettingsPatch } from '../port/settings-repository';
import { SettingsRepository } from '../port/settings-repository';

export const getSettings = (owner: OwnerId) =>
  Effect.gen(function* () {
    const settingsRepository = yield* SettingsRepository;

    return yield* settingsRepository.get(owner);
  });

export const updateRetention = (owner: OwnerId, retention: Retention) =>
  Effect.gen(function* () {
    const settingsRepository = yield* SettingsRepository;
    yield* settingsRepository.update(owner, { retention });
  });

export const updateExtraction = (
  owner: OwnerId,
  settingsPatch: SettingsPatch
) =>
  Effect.gen(function* () {
    const settingsRepository = yield* SettingsRepository;
    yield* settingsRepository.update(owner, settingsPatch);
  });
