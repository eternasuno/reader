import { ApiError, type SavedPage, savedPagesApi } from '../api';

export interface CreateSavedPageResult {
  page: SavedPage;
  created: boolean;
}

let quickSaveDraft: string | null = null;

export const peekQuickSaveDraft = (): string | null => quickSaveDraft;

export const setQuickSaveDraft = (value: string): void => {
  quickSaveDraft = value;
};

export const clearQuickSaveDraft = (): void => {
  quickSaveDraft = null;
};

const takeUrlParam = (raw: string): { value: string | null; rest: string } => {
  const params = new URLSearchParams(raw);
  if (!params.has('url')) return { value: null, rest: raw };

  const value = params.get('url') ?? '';
  params.delete('url');
  return { value, rest: params.toString() };
};

/**
 * `later.md`: consumes `/save#url=...` (or legacy `/save?url=...`) into tab-scoped in-memory
 * state and returns the stripped path so the URL never remains in the address bar or `/login?next=`.
 */
export const consumeQuickSaveLocation = (
  pathname: string,
  search: string,
  hash: string
): string | null => {
  if (pathname !== '/save') return null;

  const fromHash = takeUrlParam(hash.startsWith('#') ? hash.slice(1) : hash);
  const fromSearch = takeUrlParam(
    search.startsWith('?') ? search.slice(1) : search
  );
  const draft = fromHash.value ?? fromSearch.value;
  if (draft === null) return null;

  quickSaveDraft = draft;
  const nextSearch = fromSearch.rest.length > 0 ? `?${fromSearch.rest}` : '';
  const nextHash = fromHash.rest.length > 0 ? `#${fromHash.rest}` : '';
  return `${pathname}${nextSearch}${nextHash}`;
};

/**
 * `SP-ADD-1`: creates a saved page, or resolves a `409 SavedPageAlreadyExists` conflict
 * by fetching the existing page by `id`. Conflicts without `id` propagate as errors.
 */
export const createOrFindSavedPage = async (
  url: string
): Promise<CreateSavedPageResult> => {
  try {
    const page = await savedPagesApi.create(url);
    return { page, created: true };
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      error.code !== 'SavedPageAlreadyExists' ||
      error.id === undefined
    ) {
      throw error;
    }

    const existing = await savedPagesApi.getById(error.id);
    if (existing === null) throw error;

    return { page: existing, created: false };
  }
};
