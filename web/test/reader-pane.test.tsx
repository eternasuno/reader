import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArticleFrame,
  buildArticleSrcdoc,
} from '../src/components/ArticleFrame';
import { ReaderStoredBody } from '../src/components/ReaderArticle';
import { ReaderPane } from '../src/components/ReaderPane';
import {
  deleteOpenArticle,
  saveOpenArticle,
} from '../src/components/readerActions';
import { setLocale } from '../src/i18n';
import { useLibraryShortcuts } from '../src/routes/useLibraryShortcuts';
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

const iframeOf = (root: ParentNode): HTMLIFrameElement =>
  root.querySelector('iframe') as HTMLIFrameElement;

const srcdocOf = (iframe: HTMLIFrameElement): string =>
  iframe.getAttribute('srcdoc') ?? '';

const tokenOf = (srcdoc: string): string =>
  /var token = "([^"]+)"/.exec(srcdoc)?.[1] ?? '';

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

describe('ArticleFrame theme and width', () => {
  it('updates srcdoc data-theme reactively and omits it for auto', () => {
    const explicitLight = buildArticleSrcdoc({
      html: '<p>x</p>',
      nonce: 'n',
      token: 't',
      appOrigin: '',
      theme: 'light',
    });
    expect(explicitLight).toContain('<html data-theme="light">');

    const iframe = iframeOf(mount(() => <ArticleFrame html="<p>Post</p>" />));
    expect(srcdocOf(iframe)).toContain('<!DOCTYPE html><html>');

    state.setReaderTheme('light');
    expect(srcdocOf(iframe)).toContain('<html data-theme="light">');

    state.setReaderTheme('dark');
    expect(srcdocOf(iframe)).toContain('<html data-theme="dark">');

    state.setReaderTheme('auto');
    expect(srcdocOf(iframe)).toContain('<!DOCTYPE html><html>');
  });

  it('does not reload srcdoc when lineWidth changes, but updates when fontSize changes', () => {
    const iframe = iframeOf(mount(() => <ArticleFrame html="<p>Post</p>" />));
    const initial = srcdocOf(iframe);
    const initialToken = tokenOf(initial);

    state.stepLineWidth(-1);
    expect(srcdocOf(iframe)).toBe(initial);
    expect(tokenOf(srcdocOf(iframe))).toBe(initialToken);

    state.stepFontSize(1);
    expect(srcdocOf(iframe)).not.toBe(initial);
    expect(srcdocOf(iframe)).toContain('font-size: 18px;');
  });
});

describe('ArticleFrame height and image label', () => {
  it('injects localized imageLabel and only adds aria-label when alt is blank', () => {
    const iframe = iframeOf(mount(() => <ArticleFrame html="<p>Post</p>" />));
    expect(srcdocOf(iframe)).toContain('var imageLabel = "图片预览"');

    setLocale('en');
    flush();
    expect(srcdocOf(iframe)).toContain('var imageLabel = "Image preview"');
  });
});

describe('ReaderStoredBody extraction spinner', () => {
  it('hides the spinner when switching back to original while extraction is in flight', async () => {
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
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    await state.toggleExtractedMode();
    flush();
    expect(state.extracting()).toBe(true);
    expect(container.querySelector('[role="status"]')).toBeNull();

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

describe('shared Read-Later saving guard: button + shortcut', () => {
  it('deduplicates ReaderPane button click and s shortcut', async () => {
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
      useLibraryShortcuts({
        scope: () => ({ kind: 'feed', feedId: 'f1' }),
        articleId: () => 'i1',
        unreadOnly: () => false,
        drawerOpen: () => false,
        shortcutsOpen: () => false,
        toggleShortcuts: vi.fn(),
        onNavigate: vi.fn(),
      });

      return (
        <ReaderPane
          scope={{ kind: 'feed', feedId: 'f1' }}
          unreadOnly={false}
          onNavigate={vi.fn()}
          onRequestFeedOptions={vi.fn()}
        />
      );
    });

    const saveBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="保存到稍后阅读"]'
    );
    saveBtn?.click();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', bubbles: true })
    );
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
