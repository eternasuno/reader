import { Effect } from 'effect';
import { FetchFailure, fetchPublicText } from './http-fetch';

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

const isHtmlPage = (status: number, contentType: string | undefined) =>
  status === 200 && !!contentType?.includes('text/html');

export const fetchLinkTitle = (
  address: string
): Effect.Effect<string, FetchFailure> =>
  Effect.flatMap(
    fetchPublicText({
      url: address,
      headers: {
        accept: 'text/html',
        'accept-encoding': 'identity',
        'user-agent': 'ReadLater/1.0',
      },
      maxBytes: 128 * 1024,
      maxRedirects: 3,
    }),
    (page) => {
      if (!isHtmlPage(page.status, page.headers['content-type'])) {
        return Effect.fail(new FetchFailure({ message: 'Not HTML' }));
      }

      const match = page.body.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);

      return Effect.succeed(match?.[1] ? decodeTitle(match[1]) : '');
    }
  );
