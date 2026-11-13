import { expect, it } from '@effect/vitest';
import {
  FeedItemRepositoryError,
  FeedRepositoryError,
  SavedPageRepositoryError,
  SettingRepositoryError,
} from '@reader/business';
import { Effect } from 'effect';
import { call, readFailure, sessionFor } from '../../support/fixtures';
import {
  type Harness,
  makeHarness,
  type TestSession,
} from '../../support/harness';

const down = <E>(error: E): Effect.Effect<never, E> => Effect.fail(error);

type RepositoryFailureRow = {
  readonly _tag: string;
  readonly path: string;
  readonly query?: Record<string, number>;
  readonly stub: (
    harness: Harness,
    session: TestSession
  ) => void | Promise<void>;
};

const repositoryFailureRows: ReadonlyArray<RepositoryFailureRow> = [
  {
    _tag: 'FeedRepositoryError',
    path: '/api/library/feeds',
    stub: (harness) => {
      Object.assign(harness.repositories.feed, {
        list: () => down(new FeedRepositoryError({ message: 'down' })),
      });
    },
  },
  {
    _tag: 'FeedItemRepositoryError',
    path: '/api/library/feeds/items',
    query: { limit: 10 },
    stub: (harness) => {
      Object.assign(harness.repositories.feedItem, {
        listAll: () => down(new FeedItemRepositoryError({ message: 'down' })),
      });
    },
  },
  {
    // The harness does not expose FolderRepository, so a row the folder store
    // cannot decode surfaces the same FolderRepositoryError as a failing call.
    _tag: 'FolderRepositoryError',
    path: '/api/library/folders',
    stub: async (harness, session) => {
      await harness.db.query(
        `CREATE folder SET folderId = '01234567-89ab-7cde-8123-456789abcdef', owner = $owner, name = '';`,
        { owner: session.owner }
      );
    },
  },
  {
    _tag: 'SavedPageRepositoryError',
    path: '/api/library/saved-pages',
    query: { limit: 10 },
    stub: (harness) => {
      Object.assign(harness.repositories.savedPage, {
        list: () => down(new SavedPageRepositoryError({ message: 'down' })),
      });
    },
  },
  {
    _tag: 'SettingRepositoryError',
    path: '/api/library/settings',
    stub: (harness) => {
      Object.assign(harness.repositories.setting, {
        get: () => down(new SettingRepositoryError({ message: 'down' })),
      });
    },
  },
];

const expectRepositoryFailure = (row: RepositoryFailureRow) =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      yield* Effect.promise(async () => row.stub(harness, session));

      const response = yield* call(harness, {
        path: row.path,
        cookie: session.cookie,
        ...(row.query === undefined ? {} : { query: row.query }),
      });

      expect(response.status).toBe(500);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: row._tag,
      });
    })
  );

it.effect('rejects library requests without a session', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      const response = yield* call(harness, {
        path: '/api/library/saved-pages',
        query: { limit: 30 },
      });

      expect(response.status).toBe(401);
    })
  )
);

it.effect('rejects cross-site library modifications', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: '/api/library/saved-pages',
        cookie: session.cookie,
        origin: 'https://untrusted.example',
        body: { url: 'https://example.com/post' },
      });

      expect(response.status).toBe(403);
    })
  )
);

it.effect('maps repository failures to 500 error tags', () =>
  Effect.forEach(repositoryFailureRows, expectRepositoryFailure, {
    discard: true,
  })
);
