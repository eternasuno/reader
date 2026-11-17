import { Effect, Option, Redacted } from 'effect';
import type { Setting } from '../../../src/entity/setting/setting';
import type { SettingRepository } from '../../../src/port/setting-repository';
import { decodeBrowserEndpoint, decodeJinaKey } from '../../support/fixtures';
import { MemorySettingRepositoryLive } from '../../support/memory/setting';

export const jinaKey = decodeJinaKey('jina-secret');

export const endpoint = decodeBrowserEndpoint('ws://127.0.0.1:9222');

export const otherEndpoint = decodeBrowserEndpoint(
  'http://127.0.0.1:9333/devtools'
);

/** Every test starts from no stored setting (SET-GET-1). */
export const runSettings = <A, E>(
  effect: Effect.Effect<A, E, SettingRepository>
): Effect.Effect<A, E> =>
  effect.pipe(Effect.provide(MemorySettingRepositoryLive));

/** The stored Jina key's text, or undefined when none is stored (SET-VAL-4). */
export const storedKey = (setting: Setting): string | undefined =>
  Option.isSome(setting.jinaKey)
    ? Redacted.value(setting.jinaKey.value)
    : undefined;

/** The stored browser endpoint's serialization, or undefined (SET-VAL-3). */
export const storedEndpoint = (setting: Setting): string | undefined =>
  Option.isSome(setting.browserEndpoint)
    ? Redacted.value(setting.browserEndpoint.value).href
    : undefined;

export const endpointHref = Redacted.value(endpoint).href;

export const otherEndpointHref = Redacted.value(otherEndpoint).href;
