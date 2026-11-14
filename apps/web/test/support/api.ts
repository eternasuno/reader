import { Option } from 'effect';
import { type Article, createLibraryClient } from '../../src/api/library';

export const uuid = (suffix: string): string =>
  `019a0000-0000-7000-8000-${suffix.padStart(12, '0')}`;

export const savedId = uuid('1');
export const itemId = uuid('2');
export const feedId = uuid('3');
export const folderId = uuid('4');

export type Recorded = {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly init: RequestInit | undefined;
};

export type Handler = (request: Recorded) => Response | Promise<Response>;

export const makeClient = (handler: Handler) => {
  const requests: Array<Recorded> = [];
  const client = createLibraryClient({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const request: Recorded = {
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        init,
      };
      requests.push(request);

      return handler(request);
    },
  });

  return { client, requests };
};

export const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status });

export const failure = async (task: Promise<unknown>): Promise<unknown> =>
  task.catch((caught: unknown) => caught);

export const savedPageJson = {
  id: savedId,
  ownerId: 'owner',
  url: 'https://example.com/saved',
  title: 'Saved',
  content: '<p>Body</p>',
  read: false,
};

export const savedArticle: Article = {
  id: savedId,
  feedId: Option.none(),
  url: Option.some('https://example.com/saved'),
  title: 'Saved',
  description: Option.none(),
  content: Option.some('<p>Body</p>'),
  extractedContent: Option.some('<p>Body</p>'),
  publishedAt: undefined,
  read: false,
};

export const feedItemJson = {
  id: itemId,
  ownerId: 'owner',
  feedId,
  url: 'https://example.com/item',
  title: 'Item',
  publishedAt: '2026-01-01T00:00:00.000Z',
  read: true,
};

export const feedArticle: Article = {
  id: itemId,
  feedId: Option.some(feedId),
  url: Option.some('https://example.com/item'),
  title: 'Item',
  description: Option.none(),
  content: Option.none(),
  extractedContent: Option.none(),
  publishedAt: '2026-01-01T00:00:00.000Z',
  read: true,
};
