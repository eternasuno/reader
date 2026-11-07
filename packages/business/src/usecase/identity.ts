import { createHash } from 'node:crypto';
import { Option, Struct } from 'effect';
import { FeedId } from '../entity/feed/feed';
import { FeedItem, FeedItemId } from '../entity/feed/feed-item';
import type { NormalizedUrl } from '../entity/object-value/normalized-url';
import type { OwnerId } from '../entity/object-value/owner-id';
import { SavedPage, SavedPageId } from '../entity/saved-page/saved-page';

const sha256 = (values: ReadonlyArray<unknown>): string =>
  createHash('sha256').update(JSON.stringify(values)).digest('hex');

export const feedId = (ownerId: OwnerId, url: NormalizedUrl): FeedId =>
  FeedId.make(sha256([ownerId, url.href]));

const FeedItemIdentity = FeedItem.mapFields(
  Struct.pick(['feedId', 'url', 'title', 'description'])
);

type FeedItemIdentity = typeof FeedItemIdentity.Type;

const urlText = (url: Option.Option<NormalizedUrl>): string =>
  Option.match(url, { onNone: () => '', onSome: (value) => value.href });

export const feedItemId = ({
  feedId,
  url,
  title,
  description,
}: FeedItemIdentity): FeedItemId =>
  FeedItemId.make(
    sha256([
      urlText(url),
      title,
      Option.getOrElse(description, () => ''),
      feedId,
    ])
  );

const SavedPageIdentity = SavedPage.mapFields(
  Struct.pick(['ownerId', 'url', 'title', 'description'])
);

type SavedPageIdentity = typeof SavedPageIdentity.Type;

export const savedPageId = ({
  ownerId,
  url,
  title,
  description,
}: SavedPageIdentity): SavedPageId =>
  SavedPageId.make(
    sha256([
      urlText(url),
      title,
      Option.getOrElse(description, () => ''),
      ownerId,
    ])
  );
