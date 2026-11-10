# Feed (subscriptions and their items)

Domain: the feeds a user subscribes to and the items collected from them. A feed item and a saved page are independent: saving an item to read later makes a copy (see the SavedPage spec).

Scope: business contract only. Front-end behavior (what the list shows while loading, confirmation dialogs, request races) is not specified here.

## Entities

### Feed

| Field       | Type            | Notes                                                                      |
| ----------- | --------------- | -------------------------------------------------------------------------- |
| `id`        | `FeedId`        | `hashId(owner, url.href)` (FD-ID-1)                                        |
| `ownerId`   | `OwnerId`       |                                                                            |
| `url`       | `NormalizedUrl` | The submitted address after normalization, not a redirect target           |
| `title`     | `FeedTitle`     | Taken from the source on every sync; trimmed; empty becomes the URL's host |
| `updatedAt` | `DateTimeUtc`   | When the feed was last synced successfully, or created                     |

### FeedItem

| Field              | Type                         | Notes                                                                                                    |
| ------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `id`               | `FeedItemId`                 | With a URL: `hashId(feedId, url.href)`. Without: `hashId(feedId, title, description)` (FD-ID-2, FD-ID-3) |
| `ownerId`          | `OwnerId`                    | Items carry their owner, so no operation has to look up the feed to check ownership                      |
| `feedId`           | `FeedId`                     |                                                                                                          |
| `url`              | `Option<NormalizedUrl>`      |                                                                                                          |
| `title`            | `ArticleTitle`               |                                                                                                          |
| `description`      | `Option<ArticleDescription>` | Sanitized                                                                                                |
| `content`          | `Option<ArticleContent>`     | Sanitized                                                                                                |
| `extractedContent` | `Option<ArticleContent>`     | Filled on demand, see FD-EXTRACT                                                                         |
| `publishedAt`      | `DateTimeUtc`                | See FD-IMPORT-5 and FD-IMPORT-6                                                                          |
| `read`             | `boolean`                    | `false` when created                                                                                     |

### ParsedFeed (value, not stored)

What `FeedParser` returns: the feed `title`, an optional `description`, and the entries. An entry has `title`, optional `description`, optional `content`, optional `url` and `publishedAt`. Entry text is as the source gave it, not yet cleaned.

## Rules

### FD-ID — Identity

- FD-ID-1 A feed's id is `hashId(owner, url.href)`. The same normalized URL subscribed by the same owner is the same feed. Two owners subscribing to one URL get two feeds.
- FD-ID-2 An item with a URL has the id `hashId(feedId, url.href)`. Title and description do not take part, so a source that edits them does not create a new item or reset its read state.
- FD-ID-3 An item without a URL has the id `hashId(feedId, title, description)`. Both are the entry's text as parsed, before cleaning (CM-HTML), so a change of the sanitizer or of the length limit does not change ids. An absent description is passed as an empty string.
- FD-ID-4 The same article in two feeds is two items.

### FD-FETCH — Fetch and parse (shared by preview, subscribe and refresh)

`fetchParsedFeed(url)` fetches the source through `FeedFetcher` and parses it through `FeedParser`.

- FD-FETCH-1 It returns a `ParsedFeed`.
- FD-FETCH-2 Failure to fetch fails `FetchFeedError`. Failure to parse fails `FeedParserError`.
- FD-FETCH-3 It has no side effects and reads no stored data.

### FD-PREVIEW — Preview a subscription

1. `fetchParsedFeed(url)`.
2. Return the feed title, its description if any, and the titles of its entries.

- FD-PREVIEW-1 Nothing is stored. No subscription and no item is created.
- FD-PREVIEW-2 Errors are those of FD-FETCH.

### FD-SEL — Item selection and retention

An entry becomes a candidate with its id (FD-ID). N is the owner's retention setting.

- FD-SEL-1 Candidates have one total order: `publishedAt` descending; on equal times stored items before new entries; then `id` descending. The order of entries in the source plays no role.
- FD-SEL-2 Candidates with the same id collapse to the first one in that order.
- FD-SEL-3 The retained set: take the stored inventory, add the de-duplicated entries whose id is not stored, order, keep the first N. For a new feed the inventory is empty, so the retained set is the N newest entries.
- FD-SEL-4 Retention is by recency only. Read state plays no role, so unread items beyond N are removed like read ones.
- FD-SEL-5 An item the source no longer lists stays until FD-SEL-3 removes it.
- FD-SEL-6 A new entry older than all N retained candidates is not stored.
- FD-SEL-7 Lowering N takes effect at the next sync. Nothing is trimmed when the setting changes.
- FD-SEL-8 Selection is a pure function of the inventory, the entries and N.

Example, N = 3, items named by publish time:

| Case                           | Stored before             | Source entries        | Stored after                |
| ------------------------------ | ------------------------- | --------------------- | --------------------------- |
| New feed                       | nothing                   | t6 t5 t4 t3           | t6 t5 t4                    |
| New entry displaces the oldest | t5 t4 t3                  | t6 t5 t4 t3           | t6 t5 t4                    |
| Unread is not protected        | t5 t4 t3 (t3 unread)      | t6 t5 t4              | t6 t5 t4                    |
| Source dropped an entry        | t5 t4 t3                  | t5 t4                 | t5 t4 t3                    |
| Same time, stored first        | a@t5 (stored), c@t4, d@t3 | b@t5 c@t4 d@t3        | a@t5 b@t5 c@t4              |
| Older than everything kept     | t5 t4 t3                  | t2 t5 t4 t3           | t5 t4 t3                    |
| Title edited, has URL          | x@t5 (read)               | x@t5 with a new title | x@t5, still read, old title |

This table is the authority for the examples. `features/feed.feature` repeats the same rows as scenarios.

### FD-IMPORT — Turning entries into items

- FD-IMPORT-1 Each imported entry becomes a `FeedItem` with `read = false`, no `extractedContent`, and the owner of the feed.
- FD-IMPORT-2 `description` and `content` are cleaned before storage as in CM-HTML, cut to `FeedImportConfig.maxTextLength`.
- FD-IMPORT-3 An absent or empty description, content or URL is stored as none.
- FD-IMPORT-4 `create` skips ids that already exist. A stored item is never overwritten.
- FD-IMPORT-5 An entry that carries no publish time gets the time at which the source was parsed. The parser supplies it, so every entry of a `ParsedFeed` has a `publishedAt`.
- FD-IMPORT-6 A publish time later than now is replaced by now before selection, so a wrongly dated entry cannot stay on top of the list and outside retention forever.

### FD-SYNC — Bring a feed's items in line with its source

`syncItems(feed, parsed)`. The one place where items are written from a source; used by subscribe and by refresh.

1. Read the stored inventory of the feed and the owner's N.
2. Compute the retained set (FD-SEL-3).
3. Import the retained entries that are new (FD-IMPORT).
4. Delete the stored items of the feed that are not in the retained set.
5. Update the feed's `title` and `updatedAt = now`.

- FD-SYNC-1 Stored items are never modified. If the source changes an entry already stored, the stored item keeps its first-imported values.
- FD-SYNC-2 The writes of steps 3 to 5 are not atomic. A failure in between may leave more than N items. The next sync trims them. Items are never lost beyond the retention rule.
- FD-SYNC-3 Syncing one feed never changes another feed, nor any saved page.
- FD-SYNC-4 On failure the feed's title and `updatedAt` are not updated.
- FD-SYNC-5 Items are created only while their feed exists (see `FeedItemRepository.create`). If the feed is removed while a sync is running, the sync leaves no items behind.

### FD-SUB — Subscribe

1. `id = hashId(owner, url.href)`. If the owner already has that feed, fail `FeedAlreadyExists(id)`. Nothing is fetched.
2. `fetchParsedFeed(url)`.
3. Create the feed with the parsed title and `updatedAt = now`. If nothing was created, fail `FeedAlreadyExists(id)`.
4. `syncItems(feed, parsed)`. A failure here is logged and does not fail the use case.
5. Return the feed.

- FD-SUB-1 A duplicate is detected before any fetching.
- FD-SUB-2 Step 3 also guards against two requests subscribing at once.
- FD-SUB-3 Once the feed is created, subscribing succeeds. If step 4 fails the feed has no items yet; the next scheduled refresh fills it, because the stored inventory is empty.
- FD-SUB-4 A source with no entries still creates the subscription.

### FD-REFRESH — Refresh a feed from its source

Triggered only by the scheduler. There is no user operation to refresh a feed from its source.

1. Find the feed for this owner. If it does not exist, do nothing and succeed.
2. `fetchParsedFeed(feed.url)`.
3. `syncItems(feed, parsed)`.

- FD-REFRESH-1 A feed removed before or during the run is not an error.
- FD-REFRESH-2 Errors are those of FD-FETCH and of the repositories and cleaning used by FD-SYNC.

### FD-SCHED — Scheduled refresh (system behavior, outside business)

The scheduler lives in the application, not in `packages/business`. It calls the refresh use case. It is described here because the retention and subscribe rules rely on it. Finding the owners that have feeds is a service of the scheduler, not a business port.

- FD-SCHED-1 Every owner that has at least one feed is refreshed at a fixed interval, and immediately when first discovered. Owners are rediscovered periodically; an owner without feeds stops being scheduled.
- FD-SCHED-2 Within one owner, feeds are refreshed one after another.
- FD-SCHED-3 At most one refresh job per owner is queued or running. A fixed number of jobs run in parallel across owners.
- FD-SCHED-4 A feed that fails to refresh is logged and does not stop the others.
- FD-SCHED-5 A failed refresh is not visible to the user. No status is stored.
- FD-SCHED-6 The three numbers are the scheduler's own configuration, not business values:

| Value              | Default    | What it is for                                                                                        |
| ------------------ | ---------- | ----------------------------------------------------------------------------------------------------- |
| Refresh interval   | 30 minutes | How stale a feed may get. Shorter means fresher items and more requests to the sources                |
| Discovery interval | 1 minute   | How soon an owner's first feed starts being refreshed, and how soon an owner with no feeds is dropped |
| Parallel jobs      | 3          | Upper bound on owners refreshed at the same time, which bounds outgoing requests and memory           |

### FD-LIST — List items

Input: `owner`, optional `feedId`, `unreadOnly`, `limit`, optional `cursor`. Paging follows CM-PAGE with `publishedAt` as the sort time.

- FD-LIST-1 With a `feedId`, only items of that feed are listed. Without it, items of all of the owner's feeds are listed. No feed is looked up in either case.
- FD-LIST-2 A `feedId` that does not exist, or is not the owner's, gives an empty page (CM-OWN-3).
- FD-LIST-3 Feeds themselves are listed by title ascending, then id ascending.

### FD-OPEN — Find one item

- FD-OPEN-1 `find(owner, id)` returns `Option.some(item)` or `Option.none()`. A missing item is a normal result, not an error.
- FD-OPEN-2 An item of another owner is reported as missing.
- FD-OPEN-3 No feed is looked up.

### FD-EXTRACT — Extract an item's article

1. Find the item for this owner, else `FeedItemNotFound`.
2. If it already has `extractedContent`, return the item. Nothing is fetched.
3. If it has no URL, fail `FeedItemMissingUrl`.
4. `fetchAndExtract(item.url)` (CM-FETCH).
5. Store the content as `extractedContent` and return the updated item. If the item vanished in between, fail `FeedItemNotFound`.

- FD-EXTRACT-1 Extraction failure or empty content fails the operation and stores nothing.
- FD-EXTRACT-2 Later requests reuse the stored content. Two requests at once may both fetch; the result is the same.

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

### FD-OWN — Ownership

- FD-OWN-1 Every operation is scoped to the owner passed in (CM-OWN).
- FD-OWN-2 An unknown feed is never an error. An unknown item is an error only where the operation cannot go on without it (FD-EXTRACT, and SP-SAVE in the SavedPage spec).

## Use cases

| Use case          | Input                                                | Output                                    | Errors (besides repository errors)                              |
| ----------------- | ---------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `fetchParsedFeed` | `url`                                                | `ParsedFeed`                              | `FetchFeedError`, `FeedParserError`                             |
| `selectItems`     | inventory, entries, N                                | retained ids, entries to import           | none (pure)                                                     |
| `syncItems`       | `feed`, `ParsedFeed`                                 | nothing                                   | `HtmlParserError`, `DocumentSanitizerError`                     |
| `previewFeed`     | `url`                                                | title, optional description, entry titles | as `fetchParsedFeed`                                            |
| `subscribeFeed`   | `owner`, `url`                                       | `Feed`                                    | `FeedAlreadyExists`, and as `fetchParsedFeed`                   |
| `refreshFeed`     | `owner`, `feedId`                                    | nothing                                   | as `fetchParsedFeed` and `syncItems`                            |
| `listItems`       | `owner`, `feedId?`, `unreadOnly`, `limit`, `cursor?` | items, `cursor` or `null`                 | none                                                            |
| `extractItem`     | `owner`, `itemId`                                    | `FeedItem`                                | `FeedItemNotFound`, `FeedItemMissingUrl`, and those of CM-FETCH |

Find one item, mark items, mark feeds, mark all, unread counts, list feeds and unsubscribe are one port call each and have no use case.

## Errors

| Error                     | Carries          | Meaning                                                   | Raised by                 |
| ------------------------- | ---------------- | --------------------------------------------------------- | ------------------------- |
| `FeedAlreadyExists`       | `id` of the feed | The owner already follows this URL                        | FD-SUB steps 1 and 3      |
| `FeedItemNotFound`        | `id`             | The item does not exist for this owner                    | FD-EXTRACT, SP-SAVE       |
| `FeedItemMissingUrl`      | `id`             | The item has no URL, so there is nothing to fetch or save | FD-EXTRACT, SP-SAVE       |
| `FetchFeedError`          | message          | The source could not be fetched                           | `FeedFetcher` port        |
| `FeedParserError`         | message          | The response is not a feed                                | `FeedParser` port         |
| `FeedRepositoryError`     | message          | Storage failure                                           | `FeedRepository` port     |
| `FeedItemRepositoryError` | message          | Storage failure                                           | `FeedItemRepository` port |

## Ports

### FeedRepository

All methods are scoped by `ownerId`.

| Method                   | Contract                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `find(owner, id)`        | `Option` of the feed                                                               |
| `list(owner)`            | The owner's feeds ordered by title, then id                                        |
| `create(owner, feeds)`   | Returns the ids actually created. A feed whose id already exists is skipped        |
| `remove(owner, ids)`     | Removes the owner's feeds among `ids` **and all their items**; unknown ids ignored |
| `update(owner, updates)` | Applies a patch (`title`, `updatedAt`) to the owner's feeds                        |

### FeedItemRepository

All methods are scoped by `ownerId`.

| Method                                                | Contract                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `find(owner, id)`                                     | `Option` of the item                                                                                                                           |
| `list(owner, { feedId?, unreadOnly, after?, limit })` | Items ordered by `publishedAt` desc, `id` desc; strictly after `after` when given; at most `limit`; restricted to `feedId` when given          |
| `create(owner, items)`                                | Returns the ids actually created. An existing id is skipped, never overwritten. An item whose feed does not exist for the owner is not created |
| `update(owner, ids, patch)`                           | Applies a patch (`read`, `extractedContent`) to the owner's items among `ids`; returns the ids updated; unknown ids ignored                    |
| `updateByFeeds(owner, feedIds, patch)`                | Applies a patch to every item of the owner's feeds among `feedIds`                                                                             |
| `updateAll(owner, patch)`                             | Applies a patch to every item of the owner                                                                                                     |
| `unreadCounts(owner)`                                 | Unread count per feed of the owner                                                                                                             |
| `inventory(owner, feedId)`                            | `(id, publishedAt)` of every stored item of the feed                                                                                           |
| `retain(owner, feedId, ids)`                          | Deletes every item of the feed whose id is not in `ids`; all items if `ids` is empty                                                           |

### FeedFetcher, FeedParser

- `FeedFetcher.fetch(url)`: the body of the source as text, or `FetchFeedError`.
- `FeedParser.parse(text, url)`: a `ParsedFeed`, or `FeedParserError`. Entries without a publish time get the time of parsing (FD-IMPORT-5).

### FeedImportConfig

A configuration service provided by the application from its configuration. Business defines no default.

| Field           | Meaning                                                                       |
| --------------- | ----------------------------------------------------------------------------- |
| `maxTextLength` | Longest description or content, in characters, kept from an entry (CM-HTML-1) |

### From other domains

- `SettingRepository.get` (Setting) for N.
- `HtmlParser`, `DocumentSanitizer`, `WebpageFetcher`, `ArticleExtractor` (Common).

## Known risks

- A source whose entries carry no publish time and that lists more than N entries: an entry trimmed by retention is seen as new at the next sync, gets the current time and is imported again as unread. Such sources are rare and N is at least 30, so this is accepted.
- Raising N after lowering it brings back older entries the source still lists. They come back unread.
