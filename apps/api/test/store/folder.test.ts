import { expect, it } from '@effect/vitest';
import {
  ArticleContent,
  ArticleTitle,
  Feed,
  FeedRepository,
  FeedTitle,
  Folder,
  FolderName,
  FolderRepository,
  SavedPage,
  SavedPageRepository,
} from '@reader/business';
import { folderRepositoryContract } from '@reader/business/testing';
import { Effect, Option, Schema } from 'effect';
import {
  feedStoreLayer,
  owner,
  readerStoreDatabaseLayer,
  url,
} from '../support/store';

const alice = owner('alice');

const decodeTitle = Schema.decodeSync(ArticleTitle);

folderRepositoryContract('SurrealDB FolderRepository', feedStoreLayer);

it.effect('FD-FOLDER-7 keeps saved pages when a folder is removed', () =>
  Effect.gen(function* () {
    const folders = yield* FolderRepository;
    const feeds = yield* FeedRepository;
    const pages = yield* SavedPageRepository;
    const folder = Folder.make({
      ownerId: alice,
      name: FolderName.make('Tech'),
    });
    const feed = Feed.make({
      ownerId: alice,
      url: url('https://example.com/folder/feed.xml'),
      title: FeedTitle.make('Feed'),
      folderId: Option.some(folder.id),
      updatedAt: Option.none(),
    });
    const page = SavedPage.make({
      ownerId: alice,
      url: url('https://example.com/folder/saved'),
      title: decodeTitle('Saved'),
      description: Option.none(),
      content: ArticleContent.make('<p>Body</p>'),
      publishedAt: Option.none(),
      read: false,
    });
    yield* folders.create(alice, [folder]);
    yield* feeds.create(alice, [feed]);
    yield* pages.create(alice, [page]);

    yield* folders.remove(alice, [folder.id]);

    expect(Option.isNone(yield* feeds.find(alice, feed.id))).toBe(true);
    expect(yield* pages.find(alice, page.id)).toStrictEqual(Option.some(page));
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);
