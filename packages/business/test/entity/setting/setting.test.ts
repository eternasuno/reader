import { describe, expect, it } from '@effect/vitest';
import { Option, Redacted, Result, Schema } from 'effect';
import { OwnerId } from '../../../src/entity/common/owner-id';
import { Setting } from '../../../src/entity/setting/setting';

const alice = OwnerId.make('alice');

const decode = Schema.decodeUnknownResult(Setting);

const decodeSetting = (input: unknown): Setting =>
  Result.getOrThrow(decode(input));

describe('Setting', () => {
  it('SET-GET-1 gives a user without stored settings retention 100, provider jina, no key and no endpoint', () => {
    const setting = decodeSetting({ ownerId: alice });

    expect(setting.ownerId).toBe(alice);
    expect(setting.retention).toBe(100);
    expect(setting.provider).toBe('jina');
    expect(setting.jinaKey).toEqual(Option.none());
    expect(setting.browserEndpoint).toEqual(Option.none());
    expect(setting.nextSendAt).toEqual(Option.none());
  });

  it('SET-VAL-1 keeps a stored retention', () => {
    expect(decodeSetting({ ownerId: alice, retention: 30 }).retention).toBe(30);
  });

  it('SET-FETCH-5 keeps both provider configurations side by side', () => {
    const setting = decodeSetting({
      ownerId: alice,
      provider: 'browser',
      jinaKey: ' secret ',
      browserEndpoint: 'http://127.0.0.1:9222',
    });

    expect(setting.provider).toBe('browser');
    expect(Redacted.value(Option.getOrThrow(setting.jinaKey))).toBe('secret');
    expect(
      Redacted.value(Option.getOrThrow(setting.browserEndpoint)).href
    ).toBe('http://127.0.0.1:9222/');
  });

  it('SET-VAL-6 treats an omitted or blank key and endpoint as not given', () => {
    const setting = decodeSetting({
      ownerId: alice,
      jinaKey: '   ',
      browserEndpoint: '',
    });

    expect(setting.jinaKey).toEqual(Option.none());
    expect(setting.browserEndpoint).toEqual(Option.none());
  });
});
