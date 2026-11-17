import { describe, expect, it } from '@effect/vitest';
import { Redacted, Result, Schema } from 'effect';
import {
  BrowserEndpoint,
  FetcherProvider,
  JinaKey,
} from '../../../src/entity/setting/fetcher';

const decodeProvider = Schema.decodeUnknownResult(FetcherProvider);

const decodeKey = Schema.decodeUnknownResult(JinaKey);

const decodeEndpoint = Schema.decodeUnknownResult(BrowserEndpoint);

const isFailure = (result: Result.Result<unknown, unknown>): boolean =>
  Result.isFailure(result);

describe('FetcherProvider', () => {
  it('SET-GET-1 defaults to jina', () => {
    expect(Result.getOrThrow(decodeProvider(undefined))).toBe('jina');
  });

  it('SET-FETCH accepts exactly the two providers', () => {
    expect(Result.getOrThrow(decodeProvider('jina'))).toBe('jina');
    expect(Result.getOrThrow(decodeProvider('browser'))).toBe('browser');
    expect(isFailure(decodeProvider('other'))).toBe(true);
  });
});

describe('JinaKey', () => {
  it('SET-VAL-2 trims the key', () => {
    for (const value of ['  secret  ', '\tsecret ', ' secret\n']) {
      const key = Result.getOrThrow(decodeKey(value));

      expect(Redacted.value(key)).toBe('secret');
    }
  });

  it('SET-VAL-2 rejects a blank key', () => {
    for (const value of ['', '   ']) {
      expect(isFailure(decodeKey(value))).toBe(true);
    }
  });

  it('SET-VAL-4 redacts the key in strings and in JSON', () => {
    const key = Result.getOrThrow(decodeKey('secret'));

    expect(Redacted.isRedacted(key)).toBe(true);
    expect(String(key)).not.toContain('secret');
    expect(JSON.stringify({ key })).not.toContain('secret');
  });
});

describe('BrowserEndpoint', () => {
  it('SET-VAL-3 accepts http, https, ws and wss, including credentials', () => {
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

  it('SET-VAL-3 trims surrounding whitespace', () => {
    const endpoint = Result.getOrThrow(
      decodeEndpoint('  ws://127.0.0.1:9222  ')
    );

    expect(Redacted.value(endpoint).href).toBe('ws://127.0.0.1:9222/');
  });

  it('SET-VAL-3 stores the standard serialization of the URL', () => {
    const endpoint = Result.getOrThrow(decodeEndpoint('ws://127.0.0.1:9222'));

    expect(Redacted.value(endpoint).href).toBe('ws://127.0.0.1:9222/');
  });

  it('SET-VAL-3 rejects every other protocol and a non-URL', () => {
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

  it('SET-VAL-4 redacts the endpoint in strings and in JSON', () => {
    const endpoint = Result.getOrThrow(decodeEndpoint('ws://127.0.0.1:9222'));

    expect(Redacted.isRedacted(endpoint)).toBe(true);
    expect(String(endpoint)).not.toContain('127.0.0.1');
    expect(JSON.stringify({ endpoint })).not.toContain('127.0.0.1');
  });
});
