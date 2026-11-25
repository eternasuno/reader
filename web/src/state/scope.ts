/**
 * Pure route/URL and summary helpers for the library scopes (`LIB-SCOPE-1`, `AC-AUTH-4`,
 * `LIB-ROW-1`). Nothing here is reactive, so it stays trivially testable.
 */

export type LibraryScope =
  | { kind: 'later' }
  | { kind: 'all' }
  | { kind: 'feed'; feedId: string }
  | { kind: 'folder'; folderId: string };

export interface RouteState {
  scope: LibraryScope;
  articleId: string | null;
  unreadOnly: boolean;
}

export interface LibraryUrlOptions {
  articleId?: string | null;
  unreadOnly?: boolean;
}

export const isSameScope = (a: LibraryScope, b: LibraryScope): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'feed' && b.kind === 'feed') return a.feedId === b.feedId;
  if (a.kind === 'folder' && b.kind === 'folder')
    return a.folderId === b.folderId;

  return true;
};

export const scopeBasePath = (scope: LibraryScope): string => {
  switch (scope.kind) {
    case 'later':
      return '/later';
    case 'all':
      return '/all';
    case 'feed':
      return `/feed/${encodeURIComponent(scope.feedId)}`;
    case 'folder':
      return `/folder/${encodeURIComponent(scope.folderId)}`;
  }
};

/**
 * `LIB-SCOPE-1`: the unread filter is encoded as a bare `?unread` query flag, so `false` is
 * never serialized.
 */
export const buildLibraryUrl = (
  scope: LibraryScope,
  options: LibraryUrlOptions = {}
): string => {
  const base = scopeBasePath(scope);
  const articleId = options.articleId ?? null;
  const path =
    articleId === null || articleId.length === 0
      ? base
      : `${base}/${encodeURIComponent(articleId)}`;

  return options.unreadOnly === true ? `${path}?unread` : path;
};

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const parseFixedScope = (
  kind: 'later' | 'all',
  identifier: string | undefined,
  extra: string | undefined,
  unreadOnly: boolean
): RouteState | null => {
  if (extra !== undefined) return null;

  return {
    scope: { kind },
    articleId: identifier === undefined ? null : decodeSegment(identifier),
    unreadOnly,
  };
};

const parseIdScope = (
  root: 'feed' | 'folder',
  identifier: string | undefined,
  extra: string | undefined,
  unreadOnly: boolean
): RouteState | null => {
  if (identifier === undefined) return null;

  const id = decodeSegment(identifier);
  const scope: LibraryScope =
    root === 'feed'
      ? { kind: 'feed', feedId: id }
      : { kind: 'folder', folderId: id };

  return {
    scope,
    articleId: extra === undefined ? null : decodeSegment(extra),
    unreadOnly,
  };
};

/** Parses `/later`, `/later/:pageId`, `/all`, `/feed/:feedId`, `/folder/:folderId` and their
 * `/:articleId` variants. Unknown or over-long paths return `null`. */
export const parseLibraryLocation = (
  pathname: string,
  search: string
): RouteState | null => {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.length > 3) return null;

  const [root, identifier, extra] = segments;
  const unreadOnly = new URLSearchParams(search).has('unread');

  switch (root) {
    case 'later':
    case 'all':
      return parseFixedScope(root, identifier, extra, unreadOnly);
    case 'feed':
    case 'folder':
      return parseIdScope(root, identifier, extra, unreadOnly);
    default:
      return null;
  }
};

const hasUnsafeNextPathChar = (value: string): boolean => {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || char === '\\') return true;
  }

  return false;
};

/** `AC-AUTH-4`: only same-origin relative paths are accepted as a `?next=` target. */
export const sanitizeNextPath = (
  nextParam: string | null | undefined
): string => {
  if (typeof nextParam !== 'string') return '/later';

  const next = nextParam.trim();
  if (next.length === 0) return '/later';
  if (!next.startsWith('/')) return '/later';
  if (next.startsWith('//')) return '/later';
  // Backslashes and control characters are interpreted differently by browsers and servers.
  if (hasUnsafeNextPathChar(next)) return '/later';

  try {
    if (new URL(next, 'http://localhost').origin !== 'http://localhost')
      return '/later';
  } catch {
    return '/later';
  }

  return next;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const decodeCodePoint = (
  entity: string,
  radix: number,
  prefixLength: number
): string | null => {
  const code = Number.parseInt(entity.slice(prefixLength), radix);
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;

  return String.fromCodePoint(code);
};

const decodeEntity = (match: string, entity: string): string => {
  const lower = entity.toLowerCase();
  if (lower.startsWith('#x')) return decodeCodePoint(lower, 16, 2) ?? match;
  if (lower.startsWith('#')) return decodeCodePoint(lower, 10, 1) ?? match;

  return NAMED_ENTITIES[lower] ?? match;
};

const decodeEntities = (text: string): string =>
  text.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, decodeEntity);

/** `LIB-ROW-1`: plain-text summary for the 3-line article row excerpt. */
export const htmlToPlainText = (html: string | undefined | null): string => {
  if (html === undefined || html === null || html.length === 0) return '';

  const withoutBlocks = html.replace(
    /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,
    ' '
  );
  const withoutTags = withoutBlocks.replace(/<[^>]*>/g, ' ');

  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim();
};

export const hostnameOf = (rawUrl: string): string => {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return '';
  }
};

const httpUrl = (rawUrl: string): URL | null => {
  try {
    const url = new URL(rawUrl);

    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};

/** `LIB-ROW-1`: the site's `/favicon.ico`, requested directly by the browser. */
export const siteIconUrl = (rawUrl: string): string | null => {
  const url = httpUrl(rawUrl);

  return url === null ? null : `${url.origin}/favicon.ico`;
};
