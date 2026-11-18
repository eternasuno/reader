import { describe, expect, it } from '@effect/vitest';
import { Result, Schema } from 'effect';
import { HttpApi } from 'effect/http-api';
import {
  Authentication,
  feedItemListQuery,
  OriginCheck,
  ReaderApi,
  savedPageListQuery,
} from '../../src/contract';

/**
 * `HttpApi.reflect` widens response schemas to `Schema.Top`, whose decoding and
 * encoding services are `unknown`; the contract's schemas need no service, so
 * the wire codec is this one.
 */
type WireCodec = Schema.Codec<unknown, unknown, never, never>;

const wireCodec = (schema: Schema.Constraint): WireCodec =>
  schema as unknown as WireCodec;

/** Decodes a wire body and encodes it back, so the assertion sees the JSON. */
const roundTrip = (codec: WireCodec, body: unknown): unknown =>
  Schema.encodeSync(codec)(Schema.decodeSync(codec)(body));

type Responses = ReadonlyMap<
  number,
  readonly [Schema.Top, ...Array<Schema.Top>]
>;

/** What `HttpApi.reflect` reports for one endpoint. */
type EndpointFacts = {
  readonly method: string;
  readonly path: string;
  readonly middleware: ReadonlySet<unknown>;
  readonly successes: Responses;
  readonly errors: Responses;
};

const endpoints = new Map<string, EndpointFacts>();

HttpApi.reflect(ReaderApi, {
  onGroup: () => {},
  onEndpoint: ({ group, endpoint, middleware, successes, errors }) => {
    endpoints.set(`${group.identifier}/${endpoint.identifier}`, {
      method: endpoint.method,
      path: endpoint.path,
      middleware,
      successes,
      errors,
    });
  },
});

const all = [...endpoints.values()];

const reads = all.filter((endpoint) => endpoint.method === 'GET');

const writes = all.filter((endpoint) => endpoint.method !== 'GET');

const unknownId = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

const url = 'https://example.com/';

const extractionErrorSpecs = [
  'ArticleEmptyContent 422',
  'WebpageFetcherError 422',
  'ArticleExtractorError 422',
  'SettingRepositoryError 500',
] as const;

/**
 * The domain errors of each endpoint in the spec API tables (later.md,
 * feeds.md, folders.md, settings.md); middleware errors are added per method.
 */
const settingError = 'SettingRepositoryError 500';

const expectedEndpointErrors: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    'GET /api/saved-pages': ['SavedPageRepositoryError 500'],
    'GET /api/saved-pages/unread-count': ['SavedPageRepositoryError 500'],
    'GET /api/saved-pages/lookup': ['SavedPageRepositoryError 500'],
    'GET /api/saved-pages/:id': ['SavedPageRepositoryError 500'],
    'POST /api/saved-pages': [
      'InvalidPageUrl 400',
      'SavedPageAlreadyExists 409 (url)',
      ...extractionErrorSpecs,
      'SavedPageRepositoryError 500',
    ],
    'POST /api/feed-items/:id/save': [
      'FeedItemNotFound 404 (id)',
      'SavedPageAlreadyExists 409 (url)',
      ...extractionErrorSpecs,
      'FeedItemRepositoryError 500',
      'SavedPageRepositoryError 500',
    ],
    'PATCH /api/saved-pages/:id': ['SavedPageRepositoryError 500'],
    'POST /api/saved-pages/read': ['SavedPageRepositoryError 500'],
    'POST /api/saved-pages/read-all': ['SavedPageRepositoryError 500'],
    'DELETE /api/saved-pages/:id': ['SavedPageRepositoryError 500'],
    'GET /api/feeds': ['FeedRepositoryError 500'],
    'POST /api/feeds/preview': [
      'FeedUrlInvalid 400',
      'FetchFeedError 422',
      'FeedParserError 422',
    ],
    'POST /api/feeds': [
      'FeedUrlInvalid 400',
      'FolderNotFound 404 (id)',
      'FeedAlreadyExists 409 (url)',
      'FolderRepositoryError 500',
      'FeedRepositoryError 500',
    ],
    'DELETE /api/feeds/:id': ['FeedRepositoryError 500'],
    'PATCH /api/feeds/:id': [
      'FolderNotFound 404 (id)',
      'FeedRepositoryError 500',
      'FolderRepositoryError 500',
    ],
    'PUT /api/feeds/:id/reader-mode': ['FeedRepositoryError 500'],
    'PUT /api/feeds/:id/order': ['FeedRepositoryError 500'],
    'GET /api/feeds/unread-counts': ['FeedItemRepositoryError 500'],
    'POST /api/feeds/:id/read-all': ['FeedItemRepositoryError 500'],
    'GET /api/feeds/:id/items': ['FeedItemRepositoryError 500'],
    'GET /api/feed-items': ['FeedItemRepositoryError 500'],
    'GET /api/feed-items/:id': ['FeedItemRepositoryError 500'],
    'PATCH /api/feed-items/:id': ['FeedItemRepositoryError 500'],
    'POST /api/feed-items/read': ['FeedItemRepositoryError 500'],
    'POST /api/feed-items/read-all': ['FeedItemRepositoryError 500'],
    'POST /api/feed-items/:id/extract': [
      'FeedItemNotFound 404 (id)',
      ...extractionErrorSpecs,
      'FeedItemRepositoryError 500',
    ],
    'GET /api/folders': ['FolderRepositoryError 500'],
    'POST /api/folders': [
      'InvalidFolderName 400',
      'FolderAlreadyExists 409',
      'FolderRepositoryError 500',
    ],
    'PATCH /api/folders/:id': [
      'InvalidFolderName 400',
      'FolderNotFound 404 (id)',
      'FolderAlreadyExists 409',
      'FolderRepositoryError 500',
    ],
    'DELETE /api/folders/:id': ['FolderRepositoryError 500'],
    'POST /api/folders/:id/read-all': ['FeedItemRepositoryError 500'],
    'GET /api/folders/:id/items': ['FeedItemRepositoryError 500'],
    'GET /api/settings': [settingError],
    'PUT /api/settings/retention': ['InvalidRetention 400', settingError],
    'PUT /api/settings/fetcher/jina': [settingError],
    'PUT /api/settings/fetcher/browser': [
      'InvalidEndpoint 400',
      'BrowserEndpointRequired 422',
      settingError,
    ],
    'DELETE /api/settings/fetcher/jina/key': [settingError],
    'PUT /api/settings/kindle': ['InvalidKindleSetting 400', settingError],
    'DELETE /api/settings/kindle/password': [settingError],
    'POST /api/kindle/send': [
      'KindleNotConfigured 422',
      'KindleSendInProgress 409',
      'MailSenderError 422',
      'EpubBuilderError 500',
      settingError,
      'FeedRepositoryError 500',
      'FeedItemRepositoryError 500',
      'SavedPageRepositoryError 500',
    ],
  };

const middlewareErrors = (method: string): ReadonlyArray<string> =>
  method === 'GET'
    ? ['Unauthorized 401 (empty)', 'AuthUnavailable 500']
    : [
        'Unauthorized 401 (empty)',
        'Forbidden 403 (empty)',
        'AuthUnavailable 500',
      ];

const errorCatalog = [
  ...new Set([
    ...Object.values(expectedEndpointErrors).flat(),
    ...middlewareErrors('POST'),
  ]),
];

const sampleBody = (spec: string): Record<string, string> | null => {
  const [tag = '', , required] = spec.split(' ');
  if (required === '(empty)') return null;
  if (required === '(id)') return { _tag: tag, id: unknownId };
  if (required === '(url)') return { _tag: tag, url };

  return { _tag: tag };
};

/**
 * Verifies one error schema's wire shape (empty body or JSON with no message
 * and the required `id`/`url` field) and returns its spec table entry.
 */
const describeErrorSchema = (status: number, schema: Schema.Top): string => {
  const raw = wireCodec(schema);
  const matches = errorCatalog.filter(
    (spec) =>
      Number(spec.split(' ')[1]) === status &&
      Result.isSuccess(Schema.decodeResult(raw)(sampleBody(spec)))
  );
  expect(matches).toHaveLength(1);
  const spec = matches[0] as string;
  const [tag = '', , required] = spec.split(' ');
  const body = sampleBody(spec);

  if (body === null) {
    expect(Result.isFailure(Schema.decodeResult(raw)({ _tag: tag }))).toBe(
      true
    );

    return spec;
  }

  const codec = wireCodec(Schema.toCodecJson(schema));
  expect(roundTrip(codec, { ...body, message: 'hidden' })).toEqual(body);
  if (required !== undefined) {
    expect(Result.isFailure(Schema.decodeResult(codec)({ _tag: tag }))).toBe(
      true
    );
  }

  return spec;
};

const declaredErrors = (endpoint: EndpointFacts): ReadonlyArray<string> => {
  const result: Array<string> = [];
  for (const [status, schemas] of endpoint.errors) {
    for (const schema of schemas) {
      result.push(describeErrorSchema(status, schema));
    }
  }

  return result.sort();
};

const successSchema = (endpointKey: string, status: number): WireCodec => {
  const schema = endpoints.get(endpointKey)?.successes.get(status)?.[0];
  if (schema === undefined) throw new Error(`${endpointKey} has no ${status}`);

  return wireCodec(schema);
};

describe('ReaderApi', () => {
  it('answers every endpoint of the domain API tables under /api', () => {
    expect(
      all.map((endpoint) => `${endpoint.method} ${endpoint.path}`).sort()
    ).toEqual(Object.keys(expectedEndpointErrors).sort());
  });

  it('needs a session on every endpoint (SKILL.md API conventions)', () => {
    for (const endpoint of all) {
      expect(endpoint.middleware.has(Authentication)).toBe(true);
    }
  });

  it('rejects a cross-origin state-changing request and leaves reads alone', () => {
    expect(writes.length).toBeGreaterThan(0);
    for (const endpoint of writes) {
      expect(endpoint.middleware.has(OriginCheck)).toBe(true);
    }
    for (const endpoint of reads) {
      expect(endpoint.middleware.has(OriginCheck)).toBe(false);
    }
  });

  it('answers a write without a result with 204 and no body', () => {
    for (const endpoint of all.filter((it) => it.method === 'DELETE')) {
      expect([...endpoint.successes.keys()]).toEqual([204]);
    }
  });
});

describe('contract errors', () => {
  it('declares the exact tags, statuses, required fields and middleware errors per endpoint', () => {
    const actual = Object.fromEntries(
      all.map((endpoint) => [
        `${endpoint.method} ${endpoint.path}`,
        declaredErrors(endpoint),
      ])
    );
    const expected = Object.fromEntries(
      Object.entries(expectedEndpointErrors).map(([key, domainErrors]) => {
        const method = key.split(' ')[0] ?? '';

        return [key, [...domainErrors, ...middlewareErrors(method)].sort()];
      })
    );

    expect(actual).toEqual(expected);
  });
});

describe('list query', () => {
  const decode = (schema: Schema.Top, raw: Record<string, string>) =>
    Schema.decodeResult(wireCodec(Schema.toCodecStringTree(schema)))(raw);

  it('CM-PAGE-8 defaults unread to false and counts a present value as on', () => {
    const absent = decode(savedPageListQuery, { limit: '20' });
    expect(Result.getOrThrow(absent)).toEqual({ limit: 20, unread: false });

    const bare = decode(savedPageListQuery, { limit: '20', unread: '' });
    expect(Result.getOrThrow(bare)).toEqual({ limit: 20, unread: true });

    const sent = decode(feedItemListQuery, { limit: '20', unread: 'false' });
    expect(Result.getOrThrow(sent)).toEqual({ limit: 20, unread: false });
  });

  it('CM-PAGE-2 rejects a limit that is not a positive integer', () => {
    expect(Result.isFailure(decode(savedPageListQuery, { limit: '0' }))).toBe(
      true
    );
    expect(Result.isFailure(decode(savedPageListQuery, { limit: 'x' }))).toBe(
      true
    );
  });

  it('CM-PAGE-5 rejects a malformed cursor and keeps a valid one', () => {
    expect(
      Result.isFailure(decode(savedPageListQuery, { limit: '1', cursor: 'x' }))
    ).toBe(true);
    const cursor = unknownId;
    expect(
      Result.getOrThrow(decode(savedPageListQuery, { limit: '1', cursor }))
    ).toEqual({ limit: 1, unread: false, cursor });
  });
});

describe('settings response', () => {
  it('SET-VAL-4 answers the four fields and never the key or the endpoint', () => {
    const codec = successSchema('setting/getSetting', 200);
    const body = {
      retention: 100,
      provider: 'jina',
      jinaKeyConfigured: true,
      browserEndpointConfigured: true,
      jinaKey: 'secret',
      browserEndpoint: 'ws://127.0.0.1:9222/',
    };

    expect(roundTrip(codec, body)).toEqual({
      retention: 100,
      provider: 'jina',
      jinaKeyConfigured: true,
      browserEndpointConfigured: true,
    });
  });
});
