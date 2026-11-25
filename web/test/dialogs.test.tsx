import { describe, expect, it } from 'vitest';
import { currentToast, dismissToast } from '../src/ui';
import {
  addLink,
  bodyOf,
  FEED_URL,
  feed,
  folder,
  folderName,
  jsonResponse,
  POST_URL,
  PREVIEW,
  reset,
  savedPage,
  selectOption,
  submitAndSettle,
  subscribe,
  text,
  textsOf,
  urlOf,
} from './support/dialog-helpers';

describe('AddLinkDialog', () => {
  it('creates saved pages and reports duplicates inline', async () => {
    const created = savedPage({ id: 'created' });
    const out = await addLink(`  ${POST_URL}  `, [
      jsonResponse({ item: created }, 201),
    ]);

    expect(out.firstUrl).toBe('/api/saved-pages');
    expect(out.firstBody).toEqual({ url: POST_URL });
    expect(out.onSaved).toHaveBeenCalledWith(created);

    reset();
    dismissToast();
    const existing = savedPage({ id: 'existing' });
    const found = await addLink(POST_URL, [
      jsonResponse({ error: 'SavedPageAlreadyExists', id: 'existing' }, 409),
      jsonResponse({ item: existing }),
    ]);

    expect(urlOf(1)).toBe('/api/saved-pages/existing');
    expect(found.onDuplicateFound).toHaveBeenCalledWith(existing);
    expect(currentToast()).toBeNull();
  });
});

describe('SubscribeFeedDialog preview', () => {
  it('previews the feed, then subscribes into the chosen folder', async () => {
    const subscribed = feed({ folderId: 'folder-2' });
    const out = await subscribe(
      `  ${FEED_URL}  `,
      [],
      [
        jsonResponse({ preview: PREVIEW }),
        jsonResponse({ item: subscribed }, 201),
      ]
    );

    expect(out.firstUrl).toBe('/api/feeds/preview');
    expect(textsOf('option')).toEqual(['不放入目录', 'Tech', 'News']);

    selectOption('folder-2');
    await submitAndSettle();

    expect(bodyOf(1)).toMatchObject({ title: 'Go Blog', folderId: 'folder-2' });
    expect(out.onSubscribed).toHaveBeenCalledWith(subscribed);
  });

  it('subscribes without a folder and keeps private-feed credentials', async () => {
    await subscribe(
      FEED_URL,
      [],
      [jsonResponse({ preview: PREVIEW }), jsonResponse({ item: feed() }, 201)]
    );
    await submitAndSettle();

    expect(bodyOf(1)).toMatchObject({ folderId: null });

    reset();
    await subscribe(
      'https://user:secret@example.com/feed.xml',
      [],
      [jsonResponse({ preview: PREVIEW }), jsonResponse({ item: feed() }, 201)]
    );

    expect(text()).toContain(FEED_URL);
    expect(bodyOf(0)).toMatchObject({
      url: 'https://user:secret@example.com/feed.xml',
    });
  });
});

describe('SubscribeFeedDialog duplicates', () => {
  it('reuses a known duplicate and reloads for unknown ones', async () => {
    const existing = feed({ id: 'existing' });
    const known = await subscribe(
      FEED_URL,
      [existing],
      [
        jsonResponse({ preview: PREVIEW }),
        jsonResponse({ error: 'FeedAlreadyExists' }, 409),
      ]
    );
    await submitAndSettle();

    expect(known.onDuplicateFound).toHaveBeenCalledWith(existing);
    expect(currentToast()).toMatchObject({ message: '该订阅已存在' });

    reset();
    const unknown = await subscribe(
      FEED_URL,
      [],
      [
        jsonResponse({ preview: PREVIEW }),
        jsonResponse({ error: 'FeedAlreadyExists' }, 409),
        jsonResponse({
          items: [feed({ id: 'other', url: 'https://b.example/f' })],
        }),
      ]
    );
    await submitAndSettle();

    expect(unknown.lastUrl()).toBe('/api/feeds');
    expect(unknown.onDuplicateFound).not.toHaveBeenCalled();
  });
});

describe('FolderNameDialog', () => {
  it('creates a folder with the trimmed name and rejects empty ones', async () => {
    const created = folder('folder-1', 'Tech');
    const out = await folderName('create', '  Tech  ', {}, [
      jsonResponse({ item: created }, 201),
    ]);

    expect(out.firstUrl).toBe('/api/folders');
    expect(out.firstBody).toEqual({ name: 'Tech' });

    reset();
    await folderName('create', '   ', {}, []);

    expect(text()).toContain('请输入目录名称');
  });

  it('renames a folder without a folder payload', async () => {
    const out = await folderName(
      'rename',
      'Tech Blog',
      { initialName: 'Tech', folderId: 'folder-1' },
      [new Response(null, { status: 204 })]
    );

    expect(out.firstUrl).toBe('/api/folders/folder-1');
    expect(out.firstBody).toEqual({ name: 'Tech Blog' });
  });
});
