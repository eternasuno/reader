# Feed (subscriptions and their items)

Domain: the feeds a user subscribes to and the items collected from them. A feed item and a saved page are independent: saving an item to read later makes a copy (see `saved-page.md`).

Scope: business contract only. Front-end behavior (what the list shows while loading, confirmation dialogs, request races) is in the `project-architecture` skill's `reader-ui.md`; HTTP boundary behavior is in the `project-effect-api` skill.

## Entities

### Feed

| Field       | Type                  | Notes                                                                                                                   |
| ----------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`        | `FeedId`              | A new UUIDv7 made at subscribe (FD-ID-1)                                                                                |
| `ownerId`   | `OwnerId`             |                                                                                                                         |
| `url`       | `NormalizedUrl`       | The submitted address after normalization, not a redirect target                                                        |
| `title`     | `FeedTitle`           | The preview title at subscribe, then the source's title on every successful sync; trimmed; empty becomes the URL's host |
| `updatedAt` | `Option<DateTimeUtc>` | The time of the last successful sync; none until the first one (FD-SYNC step 5)                                         |

### FeedItem

| Field              | Type                         | Notes                                                                               |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------------- |
| `id`               | `FeedItemId`                 | A new UUIDv7 made when the item is imported (FD-ID-2)                               |
| `ownerId`          | `OwnerId`                    | Items carry their owner, so no operation has to look up the feed to check ownership |
| `feedId`           | `FeedId`                     |                                                                                     |
| `url`              | `NormalizedUrl`              | Required: every stored item has one; one item per feed for a URL (FD-ID-2)          |
| `title`            | `ArticleTitle`               |                                                                                     |
| `description`      | `Option<ArticleDescription>` | Sanitized                                                                           |
| `content`          | `Option<ArticleContent>`     | Sanitized                                                                           |
| `extractedContent` | `Option<ArticleContent>`     | Filled on demand, see FD-EXTRACT                                                    |
| `publishedAt`      | `Option<DateTimeUtc>`        | Display-only; takes no part in ordering, retention or paging (FD-IMPORT-5)          |
| `read`             | `boolean`                    | `false` when created                                                                |

### ParsedFeed (value, not stored)

What `FeedParser` returns: the feed `title`, an optional `description`, and the entries. An entry has `title`, optional `description`, optional `content`, required `url` and optional `publishedAt`. The parser drops every entry without a valid URL (see `FeedParser`). Entry text is as the source gave it, not yet cleaned.

## Rules

### FD-ID — Identity

- FD-ID-1 A feed's id is a new id (CM-ID), made when the feed is created. Feeds are unique per owner and URL: one owner follows a normalized URL at most once (the unique URL key, CM-ID-6). Two owners subscribing to one URL get two feeds.
- FD-ID-2 An item's id is a new id (CM-ID), made when the item is imported (FD-SYNC step 3). Items are unique per feed and URL: one item per feed for a normalized URL (CM-ID-6). Title and description take no part in identity, so a source that edits them does not create a new item or reset its read state. Entries with the same URL collapse to the first one in source order.
- FD-ID-3 The same URL in two feeds is two items.

### FD-FETCH — Fetch and parse (shared by preview and refresh)

`fetchParsedFeed(url)` fetches the source with `HttpClient` (`effect/http`) and parses it through `FeedParser`.

- FD-FETCH-1 It returns a `ParsedFeed`.
- FD-FETCH-2 Failure to fetch, including a response that is not 2xx, fails `FetchFeedError`. Failure to parse fails `FeedParserError`.
- FD-FETCH-3 It has no side effects and reads no stored data.
- FD-FETCH-4 The application provides Effect's `FetchHttpClient`, and `fetch` follows redirects; the final URL is the response's URL, the URL of the last hop. The parser resolves entry URLs against that final URL; the feed keeps the submitted URL.

### FD-PREVIEW — Preview a subscription

1. `fetchParsedFeed(url)`.
2. Return the feed title, its description if any, and the titles of its entries.

- FD-PREVIEW-1 Nothing is stored. No subscription and no item is created.
- FD-PREVIEW-2 Errors are those of FD-FETCH.
- FD-PREVIEW-3 The title is returned as a `FeedTitle`. The client sends it back when subscribing (FD-SUB).

### FD-SEL — Item selection and retention

N is the owner's retention setting. The listed entries are the first N distinct entries of the source, in the order of the source; publish times play no part. The stored list order is FD-LIST-4.

- FD-SEL-1 The listed entries are the first N distinct entries of the source, in the order of the source. Entries with the same URL (FD-ID-2) collapse to the first one. An entry that is not among them is never imported.
- FD-SEL-2 Every listed entry is retained. One that is not stored yet (no item of the feed has its URL) is imported, whatever its publish time. One that is stored is skipped.
- FD-SEL-3 The retained set is the stored items whose URL is listed, plus the other stored items, taken in list order (FD-LIST-4) from the top, until N in total; every listed entry counts toward N, also one that will fail cleaning. Every other stored item of the feed is deleted. So the removed items are the unlisted ones at the bottom of the list. A listed entry that is skipped because it cannot be cleaned (FD-IMPORT-6) still counts toward N, so the feed may hold fewer than N items until it imports.
- FD-SEL-4 Read state plays no role, so unread items beyond N are removed like read ones.
- FD-SEL-5 An item the source no longer lists stays until FD-SEL-3 removes it.
- FD-SEL-6 An entry beyond the first N of the source (after collapsing duplicates) is never imported.
- FD-SEL-7 Lowering N takes effect at the next sync. Nothing is trimmed when the setting changes.
- FD-SEL-8 Selection is a pure function of the inventory (the `id` and `url` of each stored item), the entries in source order and N. It returns the entries to import, in source order, and the ids of the stored items to delete. A new feed is the case of an empty inventory.
- FD-SEL-9 Items are built in the order they are imported, from the last listed entry to the first, and each gets its id when it is built (CM-ID-3). So the first listed entry gets the largest id of that sync and is on top (FD-LIST-4), and the entries of one sync keep their source order. Entries that are already stored or skipped for cleaning (FD-IMPORT-6) are not built and do not disturb the others.

Example, N = 3, list order shown from top to bottom. This is an illustration of the pure selection function inside `refreshFeed`, covered by unit tests; N = 3 is not a valid user setting.

| Case                                  | Stored before (list order) | Source lists (source order) | Stored after (list order) | Why                                                                    |
| ------------------------------------- | -------------------------- | --------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| New feed                              | nothing                    | d c b a                     | d c b                     | One sync imports the first N; d gets the largest id                    |
| New entry                             | d c b                      | e d c b                     | e d c                     | e gets the largest id, so it is on top; b goes                         |
| Short source                          | e d c                      | f                           | f e d                     | f is listed; e and d fill up to N in list order; c goes                |
| Source moves an old entry to the top  | e d c                      | c e d                       | e d c                     | All are stored; positions never change                                 |
| Source inserts an entry in the middle | e d c                      | e x d c                     | x e d                     | x is new, so it arrives on top; c is beyond the first N                |
| N raised from 3 to 4                  | e d c                      | e d c b                     | b e d c                   | b was removed before; imported again, it gets a new id, on top, unread |
| Title edited                          | x (read)                   | x with a new title          | x, still read, old title  | Stored items are never modified                                        |

### FD-IMPORT — Turning entries into items

- FD-IMPORT-1 Each imported entry becomes a `FeedItem` with `read = false`, no `extractedContent`, the owner of the feed, the entry's URL and an id taken at that moment (FD-SEL-9).
- FD-IMPORT-2 `description` and `content` are cleaned before storage as in CM-HTML, with the item's URL as the base for relative links. The text is not shortened.
- FD-IMPORT-3 An absent or empty description or content is stored as none. Every entry that reaches this step has a URL; the parser drops entries without one.
- FD-IMPORT-4 A stored item is never overwritten: `create` skips a row whose id or unique URL key already exists (CM-PORT-6).
- FD-IMPORT-5 The publish time is the one the source gives, if any, and is kept for display only. A missing time stays none; no fallback invents one. A time that is wrong or in the future is shown as given and changes nothing else.
- FD-IMPORT-6 An entry whose description or content cannot be cleaned (CM-HTML-4) is skipped and logged. The other entries are imported. The skipped entry is not stored, so the next sync tries it again. One bad entry never blocks a feed.
- FD-IMPORT-7 An entry whose URL is missing, or is not a valid `NormalizedUrl` after resolution against the final URL, is dropped by the parser and never imported. Every stored item therefore has a URL.

### FD-SYNC — Bring a feed's items in line with its source

The sync is part of `refreshFeed`, not a use case of its own: it is the one place where items are written from a source.

1. Read the inventory of the feed, `(id, url)` of every stored item in list order, and the owner's N.
2. Select (FD-SEL): the selection function returns the entries to import, in source order, and the ids of the stored items to delete.
3. For the entries to import, from the last to the first: clean the entry with its URL as the base (FD-IMPORT), skip it if cleaning fails (FD-IMPORT-6), otherwise build the item, which makes its id (FD-SEL-9). Then create the built items in one call.
4. Delete the items whose ids step 2 returned (`FeedItemRepository.remove`). Every one of them was stored before step 3, so nothing created there is touched.
5. Update the feed's `title` and `updatedAt = now`, the only clock read of the sync.

- FD-SYNC-1 Stored items are never modified. If the source changes an entry already stored, the stored item keeps its first-imported values.
- FD-SYNC-2 The writes of steps 3 to 5 are not atomic. A failure in between may leave some entries imported, more than N items, or the old title. The next sync converges. Items are never lost beyond the retention rule.
- FD-SYNC-3 Syncing one feed never changes another feed, nor any saved page.
- FD-SYNC-4 On failure the feed's title and `updatedAt` are not updated.
- FD-SYNC-5 Items are created only while their feed exists (see `FeedItemRepository.create`). If the feed is removed while a sync is running, the sync leaves no items behind: `create` skips items of a missing feed, and `remove` and `update` on a missing feed change nothing. A later subscription to the same address is a new feed with a new id (FD-UNSUB-5), and it gets its own items from its own refresh.
- FD-SYNC-6 The sync never runs twice at the same time for one feed. The refresh queue guarantees it (FD-SCHED-2); nothing else in the domain relies on concurrent syncs.

### FD-SUB — Subscribe

Input: `owner`, `url`, and `title` — the title the user saw in the preview. The boundary decodes it as a `FeedTitle`: trimmed, empty becomes the URL's host. Nothing is fetched or synced by the use case, and it reads no clock.

1. Build the feed `{ ownerId: owner, url, title, updatedAt: none }`; its constructor makes a new id (CM-ID-3).
2. Create it with `FeedRepository.create`. If nothing was created, fail `FeedAlreadyExists(url)`.
3. Return the feed.

The HTTP layer enqueues the new feed for refresh after the use case succeeds (FD-SCHED-7) and returns at once. The client gets a feed with no items; the items appear when the user lists again after the first refresh.

- FD-SUB-1 A duplicate is found without any network call: the owner's unique URL key makes `create` skip the row (CM-ID-6, CM-PORT-6), so no lookup happens first.
- FD-SUB-2 Two requests subscribing at once create one feed: the unique URL key makes exactly one of them succeed; the other fails `FeedAlreadyExists`, naming the URL.
- FD-SUB-3 The title is the one from the preview until the first successful refresh, which replaces it with the source's title (FD-SYNC step 5).
- FD-SUB-4 A source with no entries gives a subscription with no items. Each refresh succeeds and imports nothing.
- FD-SUB-5 An address that is not a feed (the preview was bypassed) creates a feed that stays empty; each refresh logs a failure. Accepted.

### FD-REFRESH — Refresh a feed from its source

Run only by the scheduler's refresh queue (FD-SCHED). There is no user operation to refresh a feed from its source.

1. Find the feed for this owner. If it does not exist, do nothing and succeed.
2. `fetchParsedFeed(feed.url)`.
3. Sync the feed's items with the parsed source (FD-SYNC).

- FD-REFRESH-1 A feed removed before or during the run is not an error: `find` returns none and the run is done; `create` skips items of a missing feed; `remove` and `update` on a missing feed change nothing. Other failures of the run (fetch, parse, storage) are still failures and are logged.
- FD-REFRESH-2 Every run goes through the refresh queue, so no two runs of one feed overlap (FD-SCHED-2). Errors are those of FD-FETCH and of the repositories used by FD-SYNC.

### FD-SCHED — Scheduled refresh (system behavior, outside business)

The scheduler lives in the application, not in `packages/business`. It owns the refresh queue and calls the refresh use case (FD-REFRESH). It is described here because the retention, subscribe and sync rules rely on it. Listing the feeds for the periodic run is the scheduler's own query, not a business port.

- FD-SCHED-1 Every refresh interval, all feeds are enqueued, and each feed is enqueued once at process start.
- FD-SCHED-2 Each feed has at most one outstanding refresh. An accepted request starts at once; a request for a feed whose refresh has not finished is dropped.
- FD-SCHED-3 Refreshes of different feeds run at the same time; there is no bound on how many. Different feeds of the same owner may refresh at the same time.
- FD-SCHED-4 A feed that fails to refresh is logged and does not stop the others.
- FD-SCHED-5 A failed refresh is not visible to the user. No status is stored besides `Feed.updatedAt`.
- FD-SCHED-6 The refresh interval is the scheduler's own configuration, not a business value:

| Value            | Default    | What it is for                                                                         |
| ---------------- | ---------- | -------------------------------------------------------------------------------------- |
| Refresh interval | 30 minutes | How stale a feed may get. Shorter means fresher items and more requests to the sources |

- FD-SCHED-7 Only two things enqueue: the periodic run (FD-SCHED-1) and subscribe (the HTTP layer enqueues a new feed right after it is created, FD-SUB). No user operation refreshes a feed.

### FD-LIST — List items

Input: `owner`, optional `feedId`, `unreadOnly`, `limit`, optional `cursor`. Paging follows CM-PAGE.

- FD-LIST-1 With a `feedId`, only items of that feed are listed. Without it, items of all of the owner's feeds are listed. No feed is looked up in either case.
- FD-LIST-2 A `feedId` that does not exist, or is not the owner's, gives an empty page (CM-OWN-3).
- FD-LIST-3 Feeds themselves are listed by title ascending, then id ascending.
- FD-LIST-4 Rows are ordered by `id` descending. Ids are made in creation order (CM-ID-1), so this is newest first. A single-feed list is the all-feeds list filtered by `feedId`: same order, same cursor shape (CM-PAGE-1).
- FD-LIST-5 Items keep their position while they are stored (CM-PAGE-10): a row's id never changes. An item that retention removes and a later sync imports again gets a new id: it is a new arrival, on top, and unread.

### FD-OPEN — Find one item

- FD-OPEN-1 `find(owner, id)` returns `Option.some(item)` or `Option.none()`. A missing item is a normal result, not an error.
- FD-OPEN-2 An item of another owner is reported as missing.
- FD-OPEN-3 No feed is looked up.

### FD-EXTRACT — Extract an item's article

1. Find the item for this owner, else `FeedItemNotFound`.
2. If it already has `extractedContent`, return the item. Nothing is fetched.
3. `fetchAndExtract(item.url)` (CM-FETCH).
4. Store the content as `extractedContent` and return the updated item. If `update` returns no id, the item vanished: fail `FeedItemNotFound`.

- FD-EXTRACT-1 Extraction failure or empty content fails the operation and stores nothing.
- FD-EXTRACT-2 Later requests reuse the stored content. Two requests at once may both fetch; each stores and returns what it extracted, and the last write wins.

### FD-READ — Read state

Each is a single port call, so there is no use case. They are listed separately because callers need them distinct:

| Operation               | Port call                                 | Effect                                                                                       |
| ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| Mark items (by id list) | `update(owner, ids, { read })`            | Sets `read` on exactly those items. Used for single items and "the items loaded in the list" |
| Mark feeds              | `updateByFeeds(owner, feedIds, { read })` | Sets `read` on every item of the given feeds                                                 |
| Mark all                | `updateAll(owner, { read })`              | Sets `read` on every item of every feed of the owner                                         |

- FD-READ-1 Marking unknown ids, or ids of another owner, succeeds and changes nothing.
- FD-READ-2 Marking feeds affects only feeds of the owner. Feed ids that are not the owner's are ignored.
- FD-READ-3 "Mark all unread articles read" across the library is not a Feed operation. The caller invokes this domain's "mark all" and the SavedPage domain's "mark all" separately.
- FD-READ-4 Marking is idempotent.

### FD-COUNT — Unread counts

- FD-COUNT-1 `unreadCounts(owner)` returns, per feed of the owner, the number of unread items. A feed with no unread items may be absent; absent means 0.
- FD-COUNT-2 The total is the sum over feeds.

### FD-UNSUB — Unsubscribe

- FD-UNSUB-1 Removes the listed feeds of the owner and, with them, all their items.
- FD-UNSUB-2 Ids that do not exist, or belong to another owner, succeed and change nothing.
- FD-UNSUB-3 Saved pages created from the feed's items stay.
- FD-UNSUB-4 Unread counts no longer include the removed feeds.
- FD-UNSUB-5 Subscribing again to the same URL creates a new feed with a new id. Its refresh runs on its own (FD-SCHED-2); a refresh of the old feed that is still running finds the old feed gone and creates nothing (FD-SYNC-5).

### FD-OWN — Ownership

- FD-OWN-1 Every operation is scoped to the owner passed in (CM-OWN).
- FD-OWN-2 An unknown feed is never an error. An unknown item is an error only where the operation cannot go on without it (FD-EXTRACT, and SP-SAVE in `saved-page.md`).

## Use cases

| Use case          | Input                                                | Output                                                  | Errors (besides repository errors)                                 |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `fetchParsedFeed` | `url`                                                | `ParsedFeed`                                            | `FetchFeedError`, `FeedParserError`                                |
| `previewFeed`     | `url`                                                | title (`FeedTitle`), optional description, entry titles | as `fetchParsedFeed`                                               |
| `subscribeFeed`   | `owner`, `url`, `title`                              | `Feed`                                                  | `FeedAlreadyExists`; nothing is fetched                            |
| `refreshFeed`     | `owner`, `feedId`                                    | nothing                                                 | as `fetchParsedFeed`; cleaning errors skip the entry (FD-IMPORT-6) |
| `listItems`       | `owner`, `feedId?`, `unreadOnly`, `limit`, `cursor?` | items, `cursor` or `null`                               | none                                                               |
| `extractItem`     | `owner`, `itemId`                                    | `FeedItem`                                              | `FeedItemNotFound`, and those of CM-FETCH                          |

Find one item, mark items, mark feeds, mark all, unread counts, list feeds and unsubscribe are one port call each and have no use case.

## Errors

| Error                     | Carries           | Meaning                                | Raised by                 |
| ------------------------- | ----------------- | -------------------------------------- | ------------------------- |
| `FeedAlreadyExists`       | `url` of the feed | The owner already follows this URL     | FD-SUB step 2             |
| `FeedItemNotFound`        | `id`              | The item does not exist for this owner | FD-EXTRACT, SP-SAVE       |
| `FetchFeedError`          | message           | The source could not be fetched        | `fetchParsedFeed`         |
| `FeedParserError`         | message           | The response is not a feed             | `FeedParser` port         |
| `FeedRepositoryError`     | message           | Storage failure                        | `FeedRepository` port     |
| `FeedItemRepositoryError` | message           | Storage failure                        | `FeedItemRepository` port |

## Ports

### FeedRepository

All methods are scoped by `ownerId`. Patch and write semantics are those of CM-PORT.

| Method                      | Contract                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `find(owner, id)`           | `Option` of the feed                                                                                                          |
| `list(owner)`               | The owner's feeds ordered by title, then id (FD-LIST-3)                                                                       |
| `create(owner, feeds)`      | Returns the ids actually created (CM-PORT)                                                                                    |
| `remove(owner, ids)`        | Removes the owner's feeds among `ids` **and all their items**; unknown ids ignored                                            |
| `update(owner, ids, patch)` | Applies a patch to the owner's feeds among `ids`; returns the ids that exist (CM-PORT). Writable fields: `title`, `updatedAt` |

### FeedItemRepository

All methods are scoped by `ownerId`. Patch and write semantics are those of CM-PORT.

| Method                                                | Contract                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `find(owner, id)`                                     | `Option` of the item                                                                                                                                                                                                                 |
| `list(owner, { feedId?, unreadOnly, after?, limit })` | Items ordered by `id` descending (FD-LIST-4); strictly after the cursor position when given; at most `limit`; restricted to `feedId` when given                                                                                      |
| `create(owner, items)`                                | Returns the ids actually created (CM-PORT). Items of a missing feed are skipped; the feed-exists check and the insert are one atomic write, so an item is never left without its feed when `FeedRepository.remove` runs concurrently |
| `update(owner, ids, patch)`                           | Applies a patch to the owner's items among `ids`; returns the ids that exist (CM-PORT). Writable fields: `read`, `extractedContent`                                                                                                  |
| `updateByFeeds(owner, feedIds, patch)`                | Applies a patch to every item of the owner's feeds among `feedIds`                                                                                                                                                                   |
| `updateAll(owner, patch)`                             | Applies a patch to every item of the owner                                                                                                                                                                                           |
| `unreadCounts(owner)`                                 | Unread count per feed of the owner                                                                                                                                                                                                   |
| `inventory(owner, feedId)`                            | `(id, url)` of every stored item of the feed, ordered by `id` descending                                                                                                                                                             |
| `remove(owner, ids)`                                  | Deletes the owner's items among `ids`; unknown ids ignored                                                                                                                                                                           |

### HttpClient, FeedParser

- `HttpClient` (`effect/http`) is not a port of this package: `fetchParsedFeed` uses Effect's service directly and sends a GET to the feed URL. The application provides Effect's plain `FetchHttpClient`; `fetch` follows redirects, and no address, size or time limit is added. Because `fetch` rejects a URL that carries a user name or password, `fetchParsedFeed` sends those credentials as a Basic authorization header and the URL without them (CM-URL-4).
- `FeedParser.parse(text, baseUrl)`: a `ParsedFeed`, or `FeedParserError`. Entry URLs are resolved against `baseUrl`, the final URL from the fetcher; an entry whose URL is then not a valid `NormalizedUrl` is dropped, and so is an entry with no URL. The feed keeps the submitted URL. An entry without a publish time has none. Titles are plain text; any length limit on a title is the adapter's.

### From other domains

- `SettingRepository.get` (Setting) for N.
- `HtmlParser`, `DocumentSanitizer`, `WebpageFetcher`, `ArticleExtractor` (Common).

## Known risks

- Selection trusts the source to list its newest entries first. A source that lists more than N entries with the oldest first never gets past its oldest N. Almost every source lists newest first, and most list fewer than N entries, in which case all of them are taken.
- A source that changes the order of entries already stored is not followed: stored items keep the id they arrived with, so they keep their position.
- An entry the source inserts below newer ones arrives at the top, because its id is made when it is imported. An entry brought back by raising N arrives at the top too, with a new id, and unread.
- A publish time that is wrong or in the future is shown as the source gives it and does not move the item. An item without a publish time shows no date.
