import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArticleBody } from '../src/components/ArticleBody';
import { FONT_FAMILIES } from '../src/components/articleTypography';
import { ReaderStoredBody } from '../src/components/ReaderArticle';
import { ReaderPane } from '../src/components/ReaderPane';
import {
  deleteOpenArticle,
  saveOpenArticle,
} from '../src/components/readerActions';
import { setLocale } from '../src/i18n';
import * as state from '../src/state';
import { mount, setupInteractions } from './support/list-helpers';
import {
  jsonResponse,
  makeItem,
  makePage,
  noContentResponse,
} from './support/state-fixture';

setupInteractions();
let fetchMock: ReturnType<typeof vi.fn>;

const bodyOf = (root: ParentNode): HTMLElement =>
  root.querySelector('.article-body') as HTMLElement;

const typography = (body: HTMLElement) => ({
  size: body.style.getPropertyValue('--article-font-size'),
  family: body.style.getPropertyValue('--article-font-family'),
  lineHeight: body.style.getPropertyValue('--article-line-height'),
});

const deferredResponse = (): {
  promise: Promise<Response>;
  resolve: (res: Response) => void;
} => {
  let resolveFn: (res: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveFn = resolve;
  });

  return { promise, resolve: resolveFn };
};

const saveCallsCount = (): number =>
  fetchMock.mock.calls.filter(([u]) =>
    /^\/api\/feed-items\/[^/]+\/save$/.test(String(u))
  ).length;

const makeFeedArticle = (id: string): state.LibraryArticle => ({
  ...makeItem({ id, feedId: 'f1', read: true }),
  kind: 'feed',
});

const makeSavedArticle = (id: string): state.LibraryArticle => ({
  ...makePage({ id, read: true }),
  kind: 'later',
});

const makeNav = () => ({
  listUrl: () => '/later',
  laterUrl: () => '/later',
  articleUrl: (id: string) => `/later/${id}`,
  onNavigate: vi.fn(),
});

beforeEach(() => {
  state.clearReaderState();
  state.clearLibraryState();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  state.clearReaderState();
});

describe('ArticleBody typography', () => {
  it('updates the typography CSS variables when appearance changes', () => {
    const body = bodyOf(mount(() => <ArticleBody html="<p>Post</p>" />));
    expect(typography(body)).toEqual({
      size: '1rem',
      family: FONT_FAMILIES.sans,
      lineHeight: '1.8',
    });

    state.updateReaderAppearance({ fontSize: 'lg' });
    expect(typography(body).size).toBe('1.125rem');

    state.updateReaderAppearance({ fontFamily: 'serif' });
    expect(typography(body).family).toBe(FONT_FAMILIES.serif);

    state.updateReaderAppearance({ lineHeight: 'relaxed' });
    expect(typography(body)).toEqual({
      size: '1.125rem',
      family: FONT_FAMILIES.serif,
      lineHeight: '2',
    });

    state.resetReaderAppearance();
    expect(typography(body)).toEqual({
      size: '1rem',
      family: FONT_FAMILIES.sans,
      lineHeight: '1.8',
    });
  });

  it('does not rebuild article nodes or typography when lineWidth changes', () => {
    const body = bodyOf(mount(() => <ArticleBody html="<p>Post</p>" />));
    const paragraph = body.querySelector('p');
    const before = typography(body);

    state.updateReaderAppearance({ lineWidth: 'narrow' });
    expect(body.querySelector('p')).toBe(paragraph);
    expect(typography(body)).toEqual(before);

    state.updateReaderAppearance({ fontSize: 'lg' });
    expect(body.querySelector('p')).toBe(paragraph);
    expect(typography(body).size).toBe('1.125rem');
  });
});

describe('ArticleBody image label', () => {
  it('localizes the image label and only adds aria-label when alt is blank', () => {
    const body = bodyOf(
      mount(() => (
        <ArticleBody
          html={
            '<img src="https://example.com/a.png">' +
            '<img src="https://example.com/b.png" alt="Described">'
          }
        />
      ))
    );
    const labels = () =>
      Array.from(body.querySelectorAll('img')).map((img) =>
        img.getAttribute('aria-label')
      );
    expect(labels()).toEqual(['图片预览', null]);

    setLocale('en');
    flush();
    expect(labels()).toEqual(['Image preview', null]);
  });
});

describe('ReaderStoredBody extraction', () => {
  it('keeps the original body without a spinner while extraction is in flight', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ item: makeItem({ id: 'i1', feedId: 'f1', read: true }) })
    );
    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
    const pending = deferredResponse();
    fetchMock.mockImplementationOnce(() => pending.promise);

    const container = mount(() => (
      <ReaderStoredBody article={makeFeedArticle('i1')} />
    ));
    const running = state.toggleExtractedMode();
    flush();
    expect(state.extracting()).toBe(true);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(bodyOf(container)).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();

    pending.resolve(
      jsonResponse({
        item: makeItem({
          id: 'i1',
          feedId: 'f1',
          read: true,
          extractedContent: '<p>Extracted</p>',
        }),
      })
    );
    await running;
  });
});

describe('shared Read-Later saving guard: button', () => {
  it('deduplicates repeated ReaderPane button clicks', async () => {
    const saveA = deferredResponse();
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url === '/api/feed-items/i1') {
        const item = makeItem({ id: 'i1', feedId: 'f1', read: true });

        return Promise.resolve(jsonResponse({ item }));
      }

      if (url === '/api/feed-items/i1/save') return saveA.promise;

      return Promise.resolve(jsonResponse({ items: [], count: 0 }));
    });

    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
    const container = mount(() => {
      return (
        <ReaderPane
          scope={{ kind: 'feed', feedId: 'f1' }}
          unreadOnly={false}
          onNavigate={vi.fn()}
        />
      );
    });

    const saveBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="保存到稍后阅读"]'
    );
    saveBtn?.click();
    saveBtn?.click();
    expect(saveCallsCount()).toBe(1);

    saveA.resolve(jsonResponse({ item: makePage({ id: 'p1' }) }, 201));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('shared Read-Later saving guard: per-article isolation', () => {
  it('does not let article A finally clear article B saving guard', async () => {
    const saveA = deferredResponse();
    const saveB = deferredResponse();
    fetchMock
      .mockImplementationOnce(() => saveA.promise)
      .mockImplementationOnce(() => saveB.promise);

    const reqA = saveOpenArticle(makeFeedArticle('i1'));
    const reqB1 = saveOpenArticle(makeFeedArticle('i2'));
    const reqB2 = saveOpenArticle(makeFeedArticle('i2'));
    expect(saveCallsCount()).toBe(2);

    saveA.resolve(jsonResponse({ item: makePage({ id: 'p1' }) }, 201));
    await reqA;

    const reqB3 = saveOpenArticle(makeFeedArticle('i2'));
    expect(saveCallsCount()).toBe(2);

    saveB.resolve(jsonResponse({ item: makePage({ id: 'p2' }) }, 201));
    await Promise.all([reqB1, reqB2, reqB3]);
  });
});

const expectDeleteSent = (): void => {
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/saved-pages/p1',
    expect.objectContaining({ method: 'DELETE' })
  );
};

describe('deleteOpenArticle navigation', () => {
  it('sends DELETE and navigates to /later when mounted on the deleted article', async () => {
    vi.stubGlobal('confirm', () => true);
    const nav = makeNav();
    const stopMount = state.trackLibraryMount();
    const p1 = jsonResponse({ item: makePage({ id: 'p1', read: true }) });
    fetchMock
      .mockResolvedValueOnce(p1)
      .mockResolvedValueOnce(noContentResponse());
    await state.openArticleByRoute({ kind: 'later' }, 'p1');
    await deleteOpenArticle(nav, makeSavedArticle('p1'));
    stopMount();

    expectDeleteSent();
    expect(nav.onNavigate).toHaveBeenCalledWith('/later');
  });
});

describe('deleteOpenArticle guard', () => {
  it('sends DELETE but skips navigating to /later when library unmounted during delete', async () => {
    vi.stubGlobal('confirm', () => true);
    const nav = makeNav();
    const stopMount = state.trackLibraryMount();
    const p1 = jsonResponse({ item: makePage({ id: 'p1', read: true }) });
    fetchMock
      .mockResolvedValueOnce(p1)
      .mockResolvedValueOnce(noContentResponse());
    await state.openArticleByRoute({ kind: 'later' }, 'p1');
    stopMount();
    await deleteOpenArticle(nav, makeSavedArticle('p1'));

    expectDeleteSent();
    expect(nav.onNavigate).not.toHaveBeenCalled();
  });

  it('sends DELETE but skips navigating to /later when another article opened during delete', async () => {
    vi.stubGlobal('confirm', () => true);
    const nav = makeNav();
    const stopMount = state.trackLibraryMount();
    const delPending = deferredResponse();
    const p1 = jsonResponse({ item: makePage({ id: 'p1', read: true }) });
    const p2 = jsonResponse({ item: makePage({ id: 'p2', read: true }) });
    fetchMock
      .mockResolvedValueOnce(p1)
      .mockImplementationOnce(() => delPending.promise)
      .mockResolvedValueOnce(p2);
    await state.openArticleByRoute({ kind: 'later' }, 'p1');
    const deleting = deleteOpenArticle(nav, makeSavedArticle('p1'));
    await state.openArticleByRoute({ kind: 'later' }, 'p2');
    delPending.resolve(noContentResponse());
    await deleting;
    stopMount();

    expectDeleteSent();
    expect(nav.onNavigate).not.toHaveBeenCalled();
  });
});
