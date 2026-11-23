/** Safe wrappers around `window.localStorage` that never throw (private mode, blocked cookies, quota). */

const acquireStorage = (): Storage | null => {
  try {
    if (typeof window !== 'undefined') return window.localStorage ?? null;
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export const getItem = (key: string): string | null => {
  try {
    return acquireStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

export const setItem = (key: string, value: string): void => {
  try {
    acquireStorage()?.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode / quota); keep value in memory.
  }
};

export const removeItem = (key: string): void => {
  try {
    acquireStorage()?.removeItem(key);
  } catch {
    // Storage may be unavailable; ignore removal failure.
  }
};
