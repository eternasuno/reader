import { Option, Redacted, Result, Schema } from 'effect';
import { expect, it } from 'vitest';
import {
  BrowserEndpoint,
  BrowserEndpointInput,
  BrowserEndpointUpdate,
  browserEndpointUpdate,
  DEFAULT_RETENTION,
  JinaKeyInput,
  RequiredBrowserEndpointUpdate,
  Retention,
} from '../../src/entity/setting';

const decodeRetention = Schema.decodeUnknownResult(Retention);

const decodeKey = Schema.decodeUnknownResult(JinaKeyInput);

const decodeEndpoint = Schema.decodeUnknownResult(BrowserEndpointInput);

const decodeEndpointValue = Schema.decodeUnknownResult(BrowserEndpoint);

const decodeEndpointUpdate = Schema.decodeUnknownResult(BrowserEndpointUpdate);

const decodeRequiredEndpointUpdate = Schema.decodeUnknownResult(
  RequiredBrowserEndpointUpdate
);

const decodeBrowserEndpoint = Schema.decodeUnknownResult(
  browserEndpointUpdate('browser')
);

const decodeJinaEndpoint = Schema.decodeUnknownResult(
  browserEndpointUpdate('jina')
);

const isInvalid = (result: Result.Result<unknown, unknown>) =>
  Result.isFailure(result);

it('accepts retention choices between 30 and 300', () => {
  for (const value of [30, 100, 300]) {
    expect(Result.getOrThrow(decodeRetention(value))).toBe(value);
  }

  expect(Retention.make(100)).toBe(100);
  expect(DEFAULT_RETENTION).toBe(100);
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

it('trims browser endpoints', () => {
  expect(Result.getOrThrow(decodeEndpoint('  http://127.0.0.1:9222  '))).toBe(
    'http://127.0.0.1:9222'
  );
});

it('brands nonempty browser endpoints after trimming', () => {
  expect(isInvalid(decodeEndpointValue(''))).toBe(true);
  expect(isInvalid(decodeEndpointValue('   '))).toBe(true);
  expect(
    Result.getOrThrow(decodeEndpointValue('  http://127.0.0.1:9222  '))
  ).toBe('http://127.0.0.1:9222');
});

it('rejects invalid browser endpoints', () => {
  for (const value of [
    'not-a-url',
    'ftp://127.0.0.1:9222',
    'file:///tmp/browser',
    'http://user:secret@127.0.0.1:9222',
    'https://browser.example.com/#devtools',
    'https://browser.example.com/#',
    `https://browser.example.com/${'a'.repeat(2048)}`,
  ]) {
    expect(isInvalid(decodeEndpoint(value))).toBe(true);
    expect(isInvalid(decodeEndpointUpdate(value))).toBe(true);
  }
});

it('accepts browser endpoints with supported protocols', () => {
  for (const endpoint of [
    'http://127.0.0.1:9222',
    'https://browser.example.com/devtools',
    'ws://10.0.0.5:9222',
    'wss://browser.internal:9222',
  ]) {
    expect(Result.getOrThrow(decodeEndpointUpdate(endpoint))).toEqual(
      Option.some(endpoint)
    );
  }
});

it('turns an empty endpoint into a clear request', () => {
  for (const value of ['', '   ']) {
    expect(Result.getOrThrow(decodeEndpoint(value))).toBe('');
    expect(Result.getOrThrow(decodeEndpointUpdate(value))).toEqual(
      Option.none()
    );
  }
});

it('requires an endpoint for browser extraction', () => {
  expect(isInvalid(decodeRequiredEndpointUpdate(undefined))).toBe(true);
  expect(isInvalid(decodeRequiredEndpointUpdate(''))).toBe(true);
  expect(isInvalid(decodeBrowserEndpoint(undefined))).toBe(true);
  expect(isInvalid(decodeBrowserEndpoint(''))).toBe(true);
  expect(
    Result.getOrThrow(decodeBrowserEndpoint('ws://10.0.0.5:9222'))
  ).toEqual(Option.some('ws://10.0.0.5:9222'));
});

it('keeps or clears the endpoint for other providers', () => {
  expect(Result.getOrThrow(decodeJinaEndpoint(undefined))).toBeUndefined();
  expect(Result.getOrThrow(decodeJinaEndpoint('  '))).toEqual(Option.none());
  expect(
    Result.getOrThrow(decodeJinaEndpoint('  http://127.0.0.1:9222  '))
  ).toEqual(Option.some('http://127.0.0.1:9222'));
  expect(isInvalid(decodeJinaEndpoint('not-a-url'))).toBe(true);
});
