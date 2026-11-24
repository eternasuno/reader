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
  it('returns created: true when POST succeeds', async () => {
    fetchMock.mockResolvedValueOnce(json({ item: page }, 201));

    await expect(createOrFindSavedPage(page.url)).resolves.toEqual({
      page,
      created: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
