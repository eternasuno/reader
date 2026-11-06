import { Option, Redacted, Result, Schema } from 'effect';
import { expect, it } from 'vitest';
import { OwnerId } from '../../src/entity/object-value';
import {
  BrowserEndpoint,
  FetcherProvider,
  type FetcherSetting,
  fetcherEndpoint,
  JinaKey,
  Retention,
  Setting,
} from '../../src/entity/setting';
import { JinaKeyInput } from '../../src/port/setting-input';

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

it('decodes a jina fetcher setting without a key', () => {
  const decodeSetting = Schema.decodeUnknownResult(Setting);
  const ownerId = OwnerId.make('alice');
  const setting = Result.getOrThrow(
    decodeSetting({
      ownerId,
      retention: 100,
      fetcher: { provider: 'jina' },
    })
  );

  expect(setting.ownerId).toBe(ownerId);
  expect(setting.retention).toBe(100);
  expect(setting.fetcher.provider).toBe('jina');
  expect(setting.fetcher).toMatchObject({
    key: Option.none(),
    endpoint: Option.none(),
  });
});

it('decodes a browser fetcher setting with an endpoint', () => {
  const decodeSetting = Schema.decodeUnknownResult(Setting);
  const ownerId = OwnerId.make('alice');
  const setting = Result.getOrThrow(
    decodeSetting({
      ownerId,
      retention: 100,
      fetcher: {
        provider: 'browser',
        endpoint: 'http://127.0.0.1:9222',
      },
    })
  );

  expect(setting.fetcher.provider).toBe('browser');
  expect(Option.getOrThrow(fetcherEndpoint(setting.fetcher)).href).toBe(
    'http://127.0.0.1:9222/'
  );
});

it('keeps an optional endpoint for the jina fetcher provider', () => {
  const decodeFetcher = Schema.decodeUnknownResult(Setting);
  const ownerId = OwnerId.make('alice');
  const decodeFetcherSetting = (fetcher: object): FetcherSetting =>
    Result.getOrThrow(decodeFetcher({ ownerId, retention: 100, fetcher }))
      .fetcher;

  expect(fetcherEndpoint(decodeFetcherSetting({ provider: 'jina' }))).toEqual(
    Option.none()
  );
  expect(
    Option.getOrThrow(
      fetcherEndpoint(
        decodeFetcherSetting({
          provider: 'jina',
          endpoint: 'ws://10.0.0.5:9222',
        })
      )
    ).href
  ).toBe('ws://10.0.0.5:9222/');
  expect(
    isInvalid(
      decodeFetcher({
        ownerId,
        retention: 100,
        fetcher: { provider: 'jina', endpoint: 'not-a-url' },
      })
    )
  ).toBe(true);
});

it('requires an endpoint for the browser fetcher provider', () => {
  const decodeSetting = Schema.decodeUnknownResult(Setting);
  const ownerId = OwnerId.make('alice');

  for (const fetcher of [
    { provider: 'browser' },
    { provider: 'browser', endpoint: '' },
    { provider: 'browser', endpoint: '   ' },
    { provider: 'browser', endpoint: 'not-a-url' },
  ]) {
    expect(isInvalid(decodeSetting({ ownerId, retention: 100, fetcher }))).toBe(
      true
    );
  }
});

it('defaults the fetcher provider to jina', () => {
  expect(Result.getOrThrow(decodeProvider(undefined))).toBe('jina');
  expect(Result.getOrThrow(decodeProvider('browser'))).toBe('browser');
  expect(isInvalid(decodeProvider('other'))).toBe(true);
});

it('maps blank optional fetcher fields to none', () => {
  const decodeSetting = Schema.decodeUnknownResult(Setting);
  const ownerId = OwnerId.make('alice');
  const decodeFetcherOf = (fetcher: object) =>
    Result.getOrThrow(decodeSetting({ ownerId, retention: 100, fetcher }))
      .fetcher;

  expect(
    decodeFetcherOf({ provider: 'jina', key: '  ', endpoint: '' })
  ).toEqual({ provider: 'jina', key: Option.none(), endpoint: Option.none() });
  expect(
    decodeFetcherOf({
      provider: 'browser',
      key: '',
      endpoint: 'ws://10.0.0.5:9222',
    })
  ).toMatchObject({ provider: 'browser', key: Option.none() });
});
