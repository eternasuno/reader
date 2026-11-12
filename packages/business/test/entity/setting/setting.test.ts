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

const encodeKey = Schema.encodeSync(JinaKey);

const encodeEndpoint = Schema.encodeSync(BrowserEndpoint);

const decodeSetting = Schema.decodeUnknownResult(Setting);

const isFailure = (result: Result.Result<unknown, unknown>): boolean =>
  Result.isFailure(result);

describe('Retention', () => {
  it('accepts integers from 30 to 300 and defaults to 100', () => {
    for (const value of [30, 100, 300]) {
      expect(Result.getOrThrow(decodeRetention(value))).toBe(value);
    }

    expect(Result.getOrThrow(decodeRetention(undefined))).toBe(100);
  });

  it('rejects values outside the supported integer range', () => {
    for (const value of [29, 301, 50.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isFailure(decodeRetention(value))).toBe(true);
    }
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
  it('trims leading and trailing whitespace and keeps the key redacted', () => {
    for (const value of ['  secret  ', '\tsecret ', ' secret\n']) {
      const key = Result.getOrThrow(decodeKey(value));

      expect(Redacted.value(key)).toBe('secret');
      expect(`${key}`).not.toContain('secret');
      expect(encodeKey(key)).toBe('secret');
    }
  });

  it('accepts a key of exactly 2048 characters after trimming', () => {
    expect(isFailure(decodeKey('a'.repeat(2048)))).toBe(false);
    expect(isFailure(decodeKey(` ${'a'.repeat(2048)} `))).toBe(false);
  });

  it('rejects blank, multiline and oversized keys', () => {
    for (const value of ['', '   ', 'line\nbreak', 'line\rbreak']) {
      expect(isFailure(decodeKey(value))).toBe(true);
    }

    expect(isFailure(decodeKey('a'.repeat(2049)))).toBe(true);
    expect(isFailure(decodeKey(` ${'a'.repeat(2049)} `))).toBe(true);
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

  it('is redacted and encodes back to the url string', () => {
    const endpoint = Result.getOrThrow(decodeEndpoint('ws://10.0.0.5:9222'));

    expect(`${endpoint}`).not.toContain('10.0.0.5');
    expect(encodeEndpoint(endpoint)).toBe('ws://10.0.0.5:9222/');
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
