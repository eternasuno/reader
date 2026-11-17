import { Effect, Option } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { JinaKey } from '../../entity/setting/fetcher';
import type { SettingRepositoryError } from '../../error/setting';
import { SettingRepository } from '../../port/setting-repository';

/**
 * Chooses Jina as the fetcher (SET-FETCH-1): the provider becomes `jina`; a
 * given key replaces the stored one in the same write, and none keeps the
 * stored key. The stored browser endpoint is untouched, so switching provider
 * never discards the other configuration (SET-FETCH-5). The branch is only on
 * whether the key was given; each call below is one fixed write (CM-PORT-3).
 */
export const useJina = Effect.fn('useJina')(function* (
  owner: OwnerId,
  key: Option.Option<JinaKey>
) {
  const settings = yield* SettingRepository;

  return yield* Option.match(key, {
    onNone: () => settings.selectJina(owner),
    onSome: (jinaKey) => settings.selectJinaWithKey(owner, jinaKey),
  });
});

/** The only failure of choosing Jina (SET-FETCH-1). */
export type UseJinaError = SettingRepositoryError;

/** The ports choosing Jina runs on (SET-FETCH-1). */
export type UseJinaPorts = SettingRepository;
