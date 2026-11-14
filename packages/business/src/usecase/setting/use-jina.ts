import { Effect } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { JinaKey } from '../../entity/setting/fetcher';
import {
  SettingRepository,
  type SettingRepositoryError,
} from '../../port/setting-repository';

export const useJina = (
  owner: OwnerId,
  key?: JinaKey
): Effect.Effect<void, SettingRepositoryError, SettingRepository> =>
  Effect.gen(function* () {
    const repository = yield* SettingRepository;

    return yield* key === undefined
      ? repository.selectJina(owner)
      : repository.selectJinaWithKey(owner, key);
  });
