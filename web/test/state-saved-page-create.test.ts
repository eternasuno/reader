import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api';
import { createOrFindSavedPage } from '../src/state/saved-page-create';
import { jsonResponse as json } from './support/state-fixture';

let fetchMock: ReturnType<typeof vi.fn>;

const page = {
  id: 'page-42',
  url: 'https://example.com/private',
  title: 'Private Post',
  content: '<p>Body</p>',
  read: false,
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('createOrFindSavedPage create and conflict lookup', () => {
  it('resolves 409 SavedPageAlreadyExists by id instead of redacted URL lookup', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(
          {
            error: 'SavedPageAlreadyExists',
            id: 'page-42',
            url: 'https://[redacted]@example.com/private',
          },
          409
        )
      )
      .mockResolvedValueOnce(json({ item: page }));

    await expect(
      createOrFindSavedPage('https://user:pass@example.com/private')
    ).resolves.toEqual({ page, created: false });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      '/api/saved-pages/page-42'
    );
  });
});

describe('createOrFindSavedPage errors', () => {
  it('propagates the saved-page limit error with its translated copy', async () => {
    const { setLocale, translateErrorCode } = await import('../src/i18n');
    fetchMock.mockResolvedValueOnce(
      json({ error: 'SavedPageLimitExceeded' }, 400)
    );
    await expect(createOrFindSavedPage(page.url)).rejects.toMatchObject({
      code: 'SavedPageLimitExceeded',
      status: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setLocale('en');
    expect(translateErrorCode('SavedPageLimitExceeded')).toBe(
      'Read Later can hold at most 10,000 pages'
    );
    setLocale('zh-CN');
    expect(translateErrorCode('SavedPageLimitExceeded')).toBe(
      '稍后阅读最多保存 10000 篇'
    );
  });

  it('throws when 409 SavedPageAlreadyExists lacks an id', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: 'SavedPageAlreadyExists', url: page.url }, 409)
    );

    await expect(createOrFindSavedPage(page.url)).rejects.toMatchObject({
      code: 'SavedPageAlreadyExists',
      status: 409,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when getById returns null or non-duplicate errors occur', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ error: 'SavedPageAlreadyExists', id: 'page-42' }, 409)
      )
      .mockResolvedValueOnce(json({ item: null }));

    await expect(createOrFindSavedPage(page.url)).rejects.toBeInstanceOf(
      ApiError
    );

    fetchMock.mockResolvedValueOnce(json({ error: 'InvalidPageUrl' }, 400));
    await expect(createOrFindSavedPage('bad')).rejects.toMatchObject({
      code: 'InvalidPageUrl',
      status: 400,
    });
  });
});
