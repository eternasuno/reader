import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

export const isPublicIPv4 = (address: string): boolean => {
  const parts = address.split('.').map(Number);

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b] = parts;

  return (
    a !== undefined &&
    b !== undefined &&
    a > 0 &&
    a < 224 &&
    ![10, 127].includes(a) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && [0, 168].includes(b)) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && [18, 19, 51].includes(b)) &&
    !(a === 203 && b === 0)
  );
};

const namedEntities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const decodeNumericEntity = (entity: string, numeric: string): string => {
  const code =
    numeric[0]?.toLowerCase() === 'x'
      ? Number.parseInt(numeric.slice(1), 16)
      : Number(numeric);

  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
};

const decodeNamedEntity = (
  entity: string,
  named: string | undefined
): string => {
  const key = named?.toLowerCase() ?? '';

  return namedEntities[key] ?? entity;
};

const decodeEntity = (
  entity: string,
  numeric: string | undefined,
  named: string | undefined
): string => {
  if (numeric) {
    return decodeNumericEntity(entity, numeric);
  }

  return decodeNamedEntity(entity, named);
};

const decodeTitle = (text: string): string =>
  text
    .replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp);/gi, decodeEntity)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

export const parseTitleUrl = (address: string): URL => {
  const url = new URL(address);

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  ) {
    throw new Error('Unsupported address');
  }

  return url;
};

export const resolvePinnedAddress = async (
  hostname: string
): Promise<string | undefined> => {
  const records = await lookup(hostname, { all: true, family: 4 });

  if (
    !records.length ||
    records.some((record) => !isPublicIPv4(record.address))
  ) {
    throw new Error('Private address');
  }

  return records[0]?.address;
};

const isRedirectStatus = (status?: number): boolean =>
  [301, 302, 303, 307, 308].includes(status ?? 0);

const getRedirectTarget = (
  url: URL,
  response: IncomingMessage,
  redirects: number
): string | undefined => {
  if (!isRedirectStatus(response.statusCode)) {
    return undefined;
  }

  if (!response.headers.location || redirects >= 3) {
    throw new Error('Too many redirects');
  }

  return new URL(response.headers.location, url).href;
};

const isHtmlResponse = (response: IncomingMessage): boolean =>
  response.statusCode === 200 &&
  !!response.headers['content-type']?.includes('text/html');

const collectTitleBody = (
  response: IncomingMessage,
  fallback: string
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    response.on('data', (chunk: Buffer) => {
      size += chunk.length;

      if (size > 131072) {
        response.destroy(new Error('Response too large'));

        return;
      }

      chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => {
      const match = Buffer.concat(chunks)
        .toString('utf8')
        .match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);

      resolve(match?.[1] ? decodeTitle(match[1]) : fallback);
    });
  });

const handleTitleResponse = (
  url: URL,
  fallback: string,
  signal: AbortSignal,
  redirects: number,
  response: IncomingMessage,
  resolve: (value: string) => void,
  reject: (reason: unknown) => void
): void => {
  let target: string | undefined;

  try {
    target = getRedirectTarget(url, response, redirects);
  } catch (error) {
    response.destroy();
    reject(error);

    return;
  }

  if (target) {
    response.destroy();
    loadTitle(target, signal, redirects + 1).then(resolve, reject);

    return;
  }

  if (!isHtmlResponse(response)) {
    response.destroy();
    reject(new Error('Not HTML'));

    return;
  }

  collectTitleBody(response, fallback).then(resolve, reject);
};

const requestPinnedTitle = (
  url: URL,
  fallback: string,
  signal: AbortSignal,
  pinned: string,
  redirects: number
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(
      url,
      {
        signal,
        family: 4,
        headers: {
          accept: 'text/html',
          'accept-encoding': 'identity',
          'user-agent': 'ReadLater/1.0',
        },
        lookup: (_hostname, _options, callback) => callback(null, pinned, 4),
      },
      (response) =>
        handleTitleResponse(
          url,
          fallback,
          signal,
          redirects,
          response,
          resolve,
          reject
        )
    );
    request.on('error', reject);
    request.end();
  });

const loadTitle = async (
  address: string,
  signal: AbortSignal,
  redirects = 0
): Promise<string> => {
  const url = parseTitleUrl(address);
  const pinned = await resolvePinnedAddress(url.hostname);

  signal.throwIfAborted();

  if (!pinned) {
    throw new Error('Missing address');
  }

  return requestPinnedTitle(url, address, signal, pinned, redirects);
};

const rejectOnAbort = (
  signal: AbortSignal
): { promise: Promise<never>; cleanup: () => void } => {
  let onAbort!: () => void;

  const promise = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('Timed out'));
    signal.addEventListener('abort', onAbort, { once: true });
  });

  return {
    promise,
    cleanup: () => signal.removeEventListener('abort', onAbort),
  };
};

export const fetchLinkTitle = async (url: string): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const guard = rejectOnAbort(controller.signal);

  try {
    const title = await Promise.race([
      loadTitle(url, controller.signal),
      guard.promise,
    ]);

    return title || url;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
    guard.cleanup();
  }
};
