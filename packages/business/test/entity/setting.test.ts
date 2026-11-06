import { Option, Redacted, Result, Schema } from 'effect';
import { expect, it } from 'vitest';
import { OwnerId } from '../../src/entity/object-value/owner-id';
import { Retention } from '../../src/entity/setting/feed';
import {
  BrowserEndpoint,
  FetcherProvider,
  JinaKey,
} from '../../src/entity/setting/fetcher';
import { Setting } from '../../src/entity/setting/setting';
import { JinaKeyInput } from '../../src/usecase/setting-input';

const decodeRetention = Schema.decodeUnknownResult(Retention);

const decodeProvider = Schema.decodeUnknownResult(FetcherProvider);

const decodeKey = Schema.decodeUnknownResult(JinaKeyInput);

const decodeJinaKey = Schema.decodeUnknownResult(JinaKey);

const decodeEndpoint = Schema.decodeUnknownResult(BrowserEndpoint);

const encodeEndpoint = Schema.encodeSync(BrowserEndpoint);

const isInvalid = (result: Result.Result<unknown, unknown>) =>
  Result.isFailure(result);

it('accepts retention choices between 30 and 300, defaulting to 100', () => {
  for (const value of [30, 100, 300]) {
    expect(Result.getOrThrow(decodeRetention(value))).toBe(value);
  }

  expect(Retention.make(100)).toBe(100);
  expect(Result.getOrThrow(decodeRetention(undefined))).toBe(100);
});

it('rejects retention outside the supported integer range', () => {
  for (const value of [29, 301, 30.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(isInvalid(decodeRetention(value))).toBe(true);
  }
});

it('trims and redacts API keys', () => {
  const key = Result.getOrThrow(decodeKey('  secret  '));

  expect(Redacted.value(key)).toBe('secret');
});

it('rejects blank, multiline, and oversized keys', () => {
  for (const value of [
    '',
    '   ',
    'line\nbreak',
    'line\rbreak',
    'a'.repeat(2049),
  ]) {
    expect(isInvalid(decodeKey(value))).toBe(true);
  }
});

it('trims and redacts jina keys', () => {
  const key = Result.getOrThrow(decodeJinaKey('  secret  '));

  expect(Redacted.value(key)).toBe('secret');
});

it('rejects blank jina keys', () => {
  for (const value of ['', '   ']) {
    expect(isInvalid(decodeJinaKey(value))).toBe(true);
  }
});

it('trims browser endpoints', () => {
  const endpoint = Result.getOrThrow(
    decodeEndpoint('  http://127.0.0.1:9222  ')
  );

  expect(endpoint).toBeInstanceOf(URL);
  expect(endpoint.href).toBe('http://127.0.0.1:9222/');
});

it('rejects invalid browser endpoints', () => {
  for (const value of [
    '',
    '   ',
    'not-a-url',
    'ftp://127.0.0.1:9222',
    'file:///tmp/browser',
  ]) {
    expect(isInvalid(decodeEndpoint(value))).toBe(true);
  }
});

it('accepts browser endpoints with supported protocols', () => {
  for (const endpoint of [
    'http://127.0.0.1:9222',
    'https://browser.example.com/devtools',
    'ws://10.0.0.5:9222',
    'wss://browser.internal:9222',
  ]) {
    const decoded = Result.getOrThrow(decodeEndpoint(endpoint));

    expect(decoded).toBeInstanceOf(URL);
    expect(decoded.href).toBe(new URL(endpoint).href);
  }
});

it('accepts browser endpoints with basic auth credentials', () => {
  const decoded = Result.getOrThrow(
    decodeEndpoint('http://user:secret@127.0.0.1:9222')
  );

  expect(decoded.username).toBe('user');
  expect(decoded.password).toBe('secret');
  expect(decoded.href).toBe('http://user:secret@127.0.0.1:9222/');
});

it('encodes browser endpoints back to strings', () => {
  expect(
    encodeEndpoint(Result.getOrThrow(decodeEndpoint('ws://10.0.0.5:9222')))
  ).toBe('ws://10.0.0.5:9222/');
});

const ownerId = OwnerId.make('alice');

const decodeSetting = Schema.decodeUnknownResult(Setting);

const settingOf = (fetcher: object, feed: object = {}) => ({
  ownerId,
  feed,
  fetcher,
});

it('decodes a setting with defaults for every group', () => {
  const setting = Result.getOrThrow(
    decodeSetting(settingOf({ jina: {}, browser: {} }))
  );

  expect(setting.ownerId).toBe(ownerId);
  expect(setting.feed.retention).toBe(100);
  expect(setting.fetcher).toEqual({
    provider: 'jina',
    jina: { key: Option.none() },
    browser: { endpoint: Option.none() },
  });
});

it('keeps jina and browser configuration side by side', () => {
  const { fetcher } = Result.getOrThrow(
    decodeSetting(
      settingOf({
        provider: 'browser',
        jina: { key: ' secret ' },
        browser: { endpoint: 'http://127.0.0.1:9222' },
      })
    )
  );

  expect(fetcher.provider).toBe('browser');
  expect(Redacted.value(Option.getOrThrow(fetcher.jina.key))).toBe('secret');
  expect(Option.getOrThrow(fetcher.browser.endpoint).href).toBe(
    'http://127.0.0.1:9222/'
  );
});

it('maps blank optional fetcher fields to none', () => {
  const { fetcher } = Result.getOrThrow(
    decodeSetting(settingOf({ jina: { key: '  ' }, browser: { endpoint: '' } }))
  );

  expect(fetcher.jina.key).toEqual(Option.none());
  expect(fetcher.browser.endpoint).toEqual(Option.none());
});

it('rejects an invalid browser endpoint', () => {
  expect(
    isInvalid(
      decodeSetting(settingOf({ jina: {}, browser: { endpoint: 'not-a-url' } }))
    )
  ).toBe(true);
});

it('defaults the fetcher provider to jina', () => {
  expect(Result.getOrThrow(decodeProvider(undefined))).toBe('jina');
  expect(Result.getOrThrow(decodeProvider('browser'))).toBe('browser');
  expect(isInvalid(decodeProvider('other'))).toBe(true);
});
