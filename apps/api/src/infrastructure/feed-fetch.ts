import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

type FeedDocument = { content: string; url: string };

import { parseTitleUrl, resolvePinnedAddress } from './link-title';

const collect = (response: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        response.destroy(new Error('Feed too large'));

        return;
      }

      chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

const handleResponse = (
  url: URL,
  signal: AbortSignal,
  redirects: number,
  response: IncomingMessage,
  resolve: (value: FeedDocument) => void,
  reject: (error: unknown) => void
): void => {
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
    response.destroy();
    if (!response.headers.location || redirects >= 3) {
      reject(new Error('Too many redirects'));

      return;
    }

    load(
      new URL(response.headers.location, url).href,
      signal,
      redirects + 1
    ).then(resolve, reject);

    return;
  }

  if (
    response.statusCode !== 200 ||
    (response.headers['content-encoding'] &&
      response.headers['content-encoding'] !== 'identity')
  ) {
    response.destroy();
    reject(new Error('Feed request failed'));

    return;
  }

  collect(response)
    .then((content) => resolve({ content, url: url.href }))
    .catch(reject);
};

const load = async (
  address: string,
  signal: AbortSignal,
  redirects = 0
): Promise<FeedDocument> => {
  const url = parseTitleUrl(address);
  const pinned = await resolvePinnedAddress(url.hostname);
  signal.throwIfAborted();
  if (!pinned) {
    throw new Error('Missing public address');
  }

  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(
      url,
      {
        signal,
        family: 4,
        lookup: (_host, _options, callback) => callback(null, pinned, 4),
        headers: {
          accept:
            'application/rss+xml, application/atom+xml, application/xml, text/xml',
          'accept-encoding': 'identity',
          'user-agent': 'ReadLater/1.0',
        },
      },
      (response) =>
        handleResponse(url, signal, redirects, response, resolve, reject)
    );
    request.on('error', reject);
    request.end();
  });
};

export const fetchFeed = (
  url: string,
  signal: AbortSignal
): Promise<FeedDocument> => load(url, signal);
