import { ApiError, type SavedPage, savedPagesApi } from '../api';

export interface CreateSavedPageResult {
  page: SavedPage;
  created: boolean;
}

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
