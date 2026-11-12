import { Effect, Redacted } from 'effect';
import { FetchFailure, fetchPublicText } from './http';

const JINA_ENDPOINT = 'https://r.jina.ai/';

const MAX_BYTES = 5 * 1024 * 1024;

const parseTarget = (url: string): Effect.Effect<URL, FetchFailure> =>
  Effect.try({
    try: () => {
      const address = new URL(url);

      if (!['http:', 'https:'].includes(address.protocol)) {
        throw new Error('Invalid URL');
      }

      return address;
    },
    catch: (cause) =>
      new FetchFailure({ message: 'Invalid article URL', cause }),
  });

const failureForStatus = (status: number): FetchFailure => {
  if (status === 429) {
    return new FetchFailure({ message: 'Jina rate limit exceeded' });
  }

  if (status === 401 || status === 403) {
    return new FetchFailure({ message: 'Jina API key rejected' });
  }

  return new FetchFailure({
    message: `Jina request failed with status ${status}`,
  });
};

const requestPage = (
  address: URL,
  key: Redacted.Redacted<string> | undefined
): Effect.Effect<string, FetchFailure> =>
  Effect.flatMap(
    fetchPublicText({
      url: `${JINA_ENDPOINT}${address.href}`,
      headers: {
        Accept: 'text/html',
        ...(key ? { Authorization: `Bearer ${Redacted.value(key)}` } : {}),
        'X-Return-Format': 'html',
        'X-Timeout': '30',
      },
      maxBytes: MAX_BYTES,
      maxRedirects: 0,
      redirect: 'error',
    }),
    (page) =>
      page.ok
        ? Effect.succeed(page.body)
        : Effect.fail(failureForStatus(page.status))
  );

export const fetchJina = (
  url: string,
  key: Redacted.Redacted<string> | undefined
): Effect.Effect<string, FetchFailure> =>
  Effect.flatMap(parseTarget(url), (address) => requestPage(address, key)).pipe(
    Effect.timeoutOrElse({
      duration: '40 seconds',
      orElse: () =>
        Effect.fail(new FetchFailure({ message: 'Jina request timed out' })),
    })
  );
