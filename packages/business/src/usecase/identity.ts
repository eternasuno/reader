import { createHash } from 'node:crypto';
import { ArticleId } from '../entity/article';
import { FeedId, type OwnerId } from '../entity/object-value';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'dclid',
  'fbclid',
  'msclkid',
]);

const sha256 = (values: readonly unknown[]): string =>
  createHash('sha256').update(JSON.stringify(values)).digest('hex');

const normalizeHref = (url: URL): string => normalizeUrl(url.href).href;

const removeTrackingParams = (url: URL) => {
  const matches = new Set<string>();

  for (const name of url.searchParams.keys()) {
    if (TRACKING_PARAMS.has(name.toLowerCase())) {
      matches.add(name);
    }
  }

  for (const name of matches) {
    url.searchParams.delete(name);
  }
};

export const normalizeUrl = (value: string): URL => {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('URL must use HTTP or HTTPS');
  }

  if (url.username !== '' || url.password !== '') {
    throw new TypeError('URL must not contain credentials');
  }

  removeTrackingParams(url);

  return url;
};

export const feedId = (ownerId: OwnerId, url: URL): FeedId =>
  FeedId.make(sha256([ownerId, normalizeHref(url)]));

export const articleId = (
  ownerId: OwnerId,
  feedId: FeedId | undefined,
  url: URL | undefined,
  title: string,
  description: string | undefined
): ArticleId =>
  ArticleId.make(
    sha256([
      url === undefined ? '' : normalizeHref(url),
      title.trim() || 'Untitled',
      description?.trim() ?? '',
      feedId ?? ownerId,
    ])
  );
