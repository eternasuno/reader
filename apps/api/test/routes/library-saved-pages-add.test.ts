import { expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import {
  addPage,
  listPages,
  readFailure,
  readItem,
  readPage,
  seedPage,
  sessionFor,
} from './library-saved-pages-support';
import { makeHarness } from './library-support';

const paragraph = `<p>An example article body long enough for the extractor to keep it as
      the article content of the saved page.</p>`;

const articleHtml = (head = '') => `<!doctype html>
<html>
  <head><title>Example article</title>${head}</head>
  <body>
    <article>
      <h1>Example article</h1>
      ${paragraph}
    </article>
  </body>
</html>`;

const publishedHtml = articleHtml(
  '<meta property="article:published_time" content="2020-01-02T03:04:05Z">'
);

it.effect('adds a link as a normalized unread page on top of the list', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const older = yield* seedPage(harness, session.owner, {
        url: 'https://example.com/older',
      });

      const response = yield* Effect.promise(() =>
        addPage(harness, session, ' https://example.com/post?utm_source=x#top ')
      );
      const { raw, item } = yield* Effect.promise(() => readItem(response));

      expect(response.status).toBe(201);
      expect(item.url).toBe('https://example.com/post');
      expect(item.read).toBe(false);
      expect(item.title).toBe('Example article');
      expect(item.content).toContain('example article body');
      expect(Object.hasOwn(raw, 'publishedAt')).toBe(false);

      const listed = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 10 })
      );
      const { page } = yield* Effect.promise(() => readPage(listed));

      expect(page.items.map((saved) => saved.id)).toEqual([item.id, older.id]);
      expect(page.cursor).toBeNull();
    })
  )
);

it.effect('keeps the publish time reported by the page', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      harness.stubs.webpage = () => publishedHtml;

      const response = yield* Effect.promise(() =>
        addPage(harness, session, 'https://example.com/dated')
      );
      const { raw, item } = yield* Effect.promise(() => readItem(response));

      expect(response.status).toBe(201);
      expect(raw.publishedAt).toBe('2020-01-02T03:04:05.000Z');
      expect(Option.isSome(item.publishedAt)).toBe(true);
    })
  )
);

it.effect('rejects a url that is not http or https', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      for (const url of ['ftp://example.com/post', 'not a url']) {
        const response = yield* Effect.promise(() =>
          addPage(harness, session, url)
        );

        expect(response.status).toBe(400);
        expect(yield* Effect.promise(() => readFailure(response))).toEqual({
          _tag: 'InvalidPageUrl',
          message: '请输入有效的 http 或 https 链接',
        });
      }

      const listed = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 10 })
      );
      const { page } = yield* Effect.promise(() => readPage(listed));

      expect(page.items).toEqual([]);
    })
  )
);

it.effect('rejects a url longer than the request limit', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const response = yield* Effect.promise(() =>
        addPage(harness, session, `https://example.com/${'a'.repeat(4100)}`)
      );

      expect(response.status).toBe(400);
    })
  )
);

it.effect('reports an already saved url without fetching it again', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const created = yield* Effect.promise(() =>
        addPage(harness, session, 'https://example.com/post')
      );
      const { item } = yield* Effect.promise(() => readItem(created));
      let fetches = 0;
      harness.stubs.webpage = () => {
        fetches += 1;

        return articleHtml();
      };

      const duplicate = yield* Effect.promise(() =>
        addPage(harness, session, 'https://example.com/post?utm_campaign=y')
      );

      expect(duplicate.status).toBe(409);
      expect(yield* Effect.promise(() => readFailure(duplicate))).toEqual({
        _tag: 'SavedPageAlreadyExists',
        message: '该文章已在稍后阅读中',
        url: 'https://example.com/post',
      });
      expect(fetches).toBe(0);

      const listed = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 10 })
      );
      const { page } = yield* Effect.promise(() => readPage(listed));

      expect(page.items.map((saved) => saved.id)).toEqual([item.id]);
    })
  )
);

it.effect('reports a failed fetch and saves nothing', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      harness.stubs.webpage = () =>
        new Response('unavailable', { status: 503 });

      const response = yield* Effect.promise(() =>
        addPage(harness, session, 'https://example.com/broken')
      );

      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'WebpageFetcherError',
        message: '网页抓取失败，请稍后重试',
      });

      const listed = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 10 })
      );
      const { page } = yield* Effect.promise(() => readPage(listed));

      expect(page.items).toEqual([]);
    })
  )
);

it.effect('reports a page without an article and saves nothing', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      harness.stubs.webpage = () => '<!doctype html><html><body></body></html>';

      const response = yield* Effect.promise(() =>
        addPage(harness, session, 'https://example.com/empty')
      );

      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'ArticleExtractorError',
        message: '正文提取失败，请稍后重试',
      });

      const listed = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 10 })
      );
      const { page } = yield* Effect.promise(() => readPage(listed));

      expect(page.items).toEqual([]);
    })
  )
);
