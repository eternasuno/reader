import { Clock, Effect, Schema } from 'effect';
import { LinkRepository } from '../port/link-repository';
import { LinkTitle } from '../port/link-title';

export class InvalidLink extends Schema.TaggedError<InvalidLink>()(
  'InvalidLink',
  { error: Schema.String }
) {}

export class DuplicateLink extends Schema.TaggedError<DuplicateLink>()(
  'DuplicateLink',
  { error: Schema.String }
) {}

export class LinkNotFound extends Schema.TaggedError<LinkNotFound>()(
  'LinkNotFound',
  { error: Schema.String }
) {}

export const normalizeLink = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 4096) {
    throw new Error('请输入有效的网址');
  }

  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('仅支持不含账号密码的 HTTP 或 HTTPS 网址');
  }

  return url.href;
};

export const listLinks = Effect.fn('business.listLinks')(function* (
  owner: string,
  read: boolean,
  offset: number
) {
  const repository = yield* LinkRepository;
  const items = yield* repository.list(owner, read, offset, 31);

  return { items: items.slice(0, 30), hasMore: items.length > 30 };
});

export const saveLink = Effect.fn('business.saveLink')(function* (
  owner: string,
  value: string
) {
  const url = yield* Effect.try({
    try: () => normalizeLink(value),
    catch: () => new InvalidLink({ error: '请输入有效的 HTTP 或 HTTPS 网址' }),
  });
  const titles = yield* LinkTitle;
  const title = yield* titles.fetch(url);
  const now = yield* Clock.currentTimeMillis;
  const repository = yield* LinkRepository;
  const item = yield* repository.insert(owner, {
    url,
    title,
    createdAt: new Date(now).toISOString(),
    read: false,
  });
  if (!item) {
    return yield* new DuplicateLink({ error: '这个链接已在你的清单中' });
  }

  return { item };
});

const requireLink = (found: boolean) =>
  found
    ? Effect.succeed({ ok: true })
    : Effect.fail(new LinkNotFound({ error: '链接不存在' }));

export const markLink = Effect.fn('business.markLink')(function* (
  owner: string,
  key: string,
  read: boolean
) {
  const repository = yield* LinkRepository;

  return yield* requireLink(yield* repository.mark(owner, key, read));
});

export const removeLink = Effect.fn('business.removeLink')(function* (
  owner: string,
  key: string
) {
  const repository = yield* LinkRepository;

  return yield* requireLink(yield* repository.remove(owner, key));
});
