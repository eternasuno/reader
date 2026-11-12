import { describe, expect, it } from '@effect/vitest';
import { Option, Redacted, Result, Schema } from 'effect';
import {
  BrowserEndpoint,
  FetcherProvider,
  JinaKey,
} from '../../../src/entity/setting/fetcher';
import { Retention } from '../../../src/entity/setting/retention';
import { Setting } from '../../../src/entity/setting/setting';
import { alice } from '../../support';

const decodeRetention = Schema.decodeUnknownResult(Retention);

const decodeProvider = Schema.decodeUnknownResult(FetcherProvider);

const decodeKey = Schema.decodeUnknownResult(JinaKey);

const decodeEndpoint = Schema.decodeUnknownResult(BrowserEndpoint);

const decodeSetting = Schema.decodeUnknownResult(Setting);

const isFailure = (result: Result.Result<unknown, unknown>): boolean =>
  Result.isFailure(result);

describe('Retention', () => {
  it('accepts any positive integer and defaults to 100', () => {
    for (const value of [1, 30, 100, 500]) {
      expect(Result.getOrThrow(decodeRetention(value))).toBe(value);
    }

    expect(Result.getOrThrow(decodeRetention(undefined))).toBe(100);
    expect(isFailure(decodeRetention(0))).toBe(true);
    expect(isFailure(decodeRetention(2.5))).toBe(true);
  });
});

describe('FetcherProvider', () => {
  it('accepts both providers and defaults to jina', () => {
    expect(Result.getOrThrow(decodeProvider(undefined))).toBe('jina');
    expect(Result.getOrThrow(decodeProvider('jina'))).toBe('jina');
    expect(Result.getOrThrow(decodeProvider('browser'))).toBe('browser');
    expect(isFailure(decodeProvider('other'))).toBe(true);
  });
});

describe('JinaKey', () => {
  it('trims the key and keeps it redacted', () => {
    for (const value of ['  secret  ', '\tsecret ', ' secret\n']) {
      const key = Result.getOrThrow(decodeKey(value));

      expect(Redacted.value(key)).toBe('secret');
    }
  });

  it('rejects blank keys', () => {
    for (const value of ['', '   ']) {
      expect(isFailure(decodeKey(value))).toBe(true);
    }
  });
});

describe('BrowserEndpoint', () => {
  it('accepts the supported protocols, including credentials', () => {
    for (const value of [
      'http://127.0.0.1:9222',
      'https://browser.example.com/devtools',
      'ws://10.0.0.5:9222',
      'wss://browser.internal:9222',
      'http://user:secret@127.0.0.1:9222',
    ]) {
      const endpoint = Result.getOrThrow(decodeEndpoint(value));

      expect(Redacted.value(endpoint)).toBeInstanceOf(URL);
      expect(Redacted.value(endpoint).href).toBe(new URL(value).href);
    }
  });

  it('keeps the credentials of a redacted endpoint', () => {
    const endpoint = Result.getOrThrow(
      decodeEndpoint('http://user:secret@127.0.0.1:9222')
    );

    expect(Redacted.value(endpoint).username).toBe('user');
    expect(Redacted.value(endpoint).password).toBe('secret');
  });

  it('rejects other protocols and non urls', () => {
    for (const value of [
      '',
      '   ',
      'not a url',
      'ftp://host:21',
      'file:///tmp',
    ]) {
      expect(isFailure(decodeEndpoint(value))).toBe(true);
    }
  });
});

describe('Setting', () => {
  it('fills every default group', () => {
    const setting = Result.getOrThrow(
      decodeSetting({
        ownerId: alice,
        feed: {},
        fetcher: { jina: {}, browser: {} },
      })
    );

    expect(setting.ownerId).toBe(alice);
    expect(setting.feed.retention).toBe(100);
    expect(setting.fetcher.provider).toBe('jina');
    expect(setting.fetcher.jina.key).toEqual(Option.none());
    expect(setting.fetcher.browser.endpoint).toEqual(Option.none());
  });

  it('keeps both provider configurations side by side', () => {
    const setting = Result.getOrThrow(
      decodeSetting({
        ownerId: alice,
        feed: { retention: 30 },
        fetcher: {
          provider: 'browser',
          jina: { key: ' secret ' },
          browser: { endpoint: 'http://127.0.0.1:9222' },
        },
      })
    );

    expect(setting.feed.retention).toBe(30);
    expect(setting.fetcher.provider).toBe('browser');
    expect(Redacted.value(Option.getOrThrow(setting.fetcher.jina.key))).toBe(
      'secret'
    );
    expect(
      Redacted.value(Option.getOrThrow(setting.fetcher.browser.endpoint)).href
    ).toBe('http://127.0.0.1:9222/');
  });
});
