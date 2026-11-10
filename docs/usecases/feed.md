# Feed (subscriptions and their items)

Domain: the feeds a user subscribes to and the items collected from them. A feed item and a saved page are independent: saving an item to read later makes a copy (see the SavedPage spec).

Scope: business contract only. Front-end behavior (what the list shows while loading, confirmation dialogs, request races) is not specified here.

## Entities

### Feed

| Field       | Type            | Notes                                                            |
| ----------- | --------------- | ---------------------------------------------------------------- |
| `id`        | `FeedId`        | `hashId(owner, url.href)` (FD-ID-1)                              |
| `ownerId`   | `OwnerId`       |                                                                  |
| `url`       | `NormalizedUrl` | The submitted address after normalization, not a redirect target |
| `title`     | `string`        | Taken from the source; updated on every refresh                  |
| `updatedAt` | `DateTimeUtc`   | When the feed was last refreshed, or created                     |

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
| `extractedContent` | `Option<ArticleContent>`     | Filled on demand, see FI-EXTRACT                                                                         |
| `publishedAt`      | `DateTimeUtc`                |                                                                                                          |
| `read`             | `boolean`                    | `false` when created                                                                                     |

Parsing and validation happen only at the boundary. Past it, branded values are trusted.

## Rules

### FD-ID — Identity

- FD-ID-1 A feed's id is `hashId(owner, url.href)`. The same normalized URL subscribed by the same owner is the same feed. Two owners subscribing to one URL get two feeds.
- FD-ID-2 An item with a URL has the id `hashId(feedId, url.href)`. Title and description do not take part, so a source that edits them does not create a new item or reset its read state.
- FD-ID-3 An item without a URL has the id `hashId(feedId, title, description)`, with an absent description passed as an empty string.
- FD-ID-4 The same article in two feeds is two items.

### FD-FETCH — Fetch and parse (shared by preview, subscribe and refresh)

`fetchParsedFeed(url)` fetches the source through `FeedFetcher` and parses it through `FeedParser`.

- FD-FETCH-1 It returns the parsed feed: title, description, and the entries (title, description, content, url, publishedAt).
- FD-FETCH-2 Failure to fetch fails `FetchFeedError`. Failure to parse fails `FeedParserError`.
- FD-FETCH-3 It has no side effects and reads no stored data.

### FD-PREVIEW — Preview a subscription

1. `fetchParsedFeed(url)`.
2. Return the feed title, its description if any, and the titles of its entries.

- FD-PREVIEW-1 Nothing is stored. No subscription and no item is created.
- FD-PREVIEW-2 Errors are those of FD-FETCH.

### FD-SUB — Subscribe

1. `id = hashId(owner, url.href)`. If the owner already has that feed, fail `FeedExists(id)`. Nothing is fetched.
2. `fetchParsedFeed(url)`.
3. Read the owner's retention setting N.
4. Create the feed with the parsed title and `updatedAt = now`. If nothing was created, fail `FeedExists(id)`.
5. Import the initial selection (FD-SEL-3) of the entries.

- FD-SUB-1 A duplicate is detected before any fetching.
- FD-SUB-2 Step 4 also guards against two requests subscribing at once.
- FD-SUB-3 If step 5 fails, the feed is kept with no items and the use case fails `FeedImportFailed(id)`. The next scheduled refresh fills it, because the stored inventory is empty.
- FD-SUB-4 A source with no entries still creates the subscription.
- FD-SUB-5 Subscribing depends on `SettingsRepository` for N.

### FD-SEL — Item selection and retention

An entry becomes a candidate with its id (FD-ID). N is the owner's retention setting.

- FD-SEL-1 Order: `publishedAt` descending. On equal times, stored items come before new entries; stored items among themselves by `id` descending; new entries among themselves in source order.
- FD-SEL-2 Candidates with the same id collapse to the first one in that order.
- FD-SEL-3 Initial selection: order and de-duplicate the entries, keep the first N.
- FD-SEL-4 Refresh selection: take the stored inventory, add the de-duplicated entries whose id is not stored, order, keep the first N. This is the retained set.
- FD-SEL-5 Retention is by recency only. Read state plays no role, so unread items beyond N are removed like read ones.
- FD-SEL-6 An item the source no longer lists stays until FD-SEL-4 removes it.
- FD-SEL-7 A new entry older than all N retained candidates is not stored.
- FD-SEL-8 Lowering N takes effect at the next refresh. Nothing is trimmed when the setting changes.

Example, N = 3, items named by publish time:

| Case                           | Stored before             | Source entries        | Stored after                |
| ------------------------------ | ------------------------- | --------------------- | --------------------------- |
| New entry displaces the oldest | t5 t4 t3                  | t6 t5 t4 t3           | t6 t5 t4                    |
| Unread is not protected        | t5 t4 t3 (t3 unread)      | t6 t5 t4              | t6 t5 t4                    |
| Source dropped an entry        | t5 t4 t3                  | t5 t4                 | t5 t4 t3                    |
| Same time, stored first        | a@t5 (stored), c@t4, d@t3 | b@t5 c@t4 d@t3        | a@t5 b@t5 c@t4              |
| Older than everything kept     | t5 t4 t3                  | t2 t5 t4 t3           | t5 t4 t3                    |
| Title edited, has URL          | x@t5 (read)               | x@t5 with a new title | x@t5, still read, old title |

### FD-IMPORT — Importing entries

- FD-IMPORT-1 Each imported entry becomes a `FeedItem` with `read = false`, no `extractedContent`, and the owner of the feed.
- FD-IMPORT-2 `description` and `content` are cleaned before storage as in CM-HTML: cut to a limit supplied by the caller, parsed as HTML and sanitized.
- FD-IMPORT-3 An absent or empty description, content or URL is stored as none.
- FD-IMPORT-4 `create` skips ids that already exist. A stored item is never overwritten.

### FD-REFRESH — Refresh a feed from its source

Triggered only by the scheduler. There is no user operation to refresh a feed from its source.

1. Find the feed for this owner, else `FeedNotFound`.
2. `fetchParsedFeed(feed.url)`.
3. Read the stored inventory of the feed and the owner's N.
4. Compute the retained set (FD-SEL-4).
5. Import the retained entries that are new, then delete the stored items of the feed that are not in the retained set, then update the feed's `title` and `updatedAt`.

- FD-REFRESH-1 Stored items are never modified. If the source changes the content of an entry already stored, the stored item keeps its first-imported values.
- FD-REFRESH-2 The three writes of step 5 are not atomic. A failure in between may leave more than N items. The next refresh trims them. Items are never lost beyond the retention rule.
- FD-REFRESH-3 Refreshing one feed never changes another feed, nor any saved page.
- FD-REFRESH-4 On failure the feed's title and `updatedAt` are not updated.

### FD-SCHED — Scheduled refresh (system behavior)

- FD-SCHED-1 Every owner that has at least one feed is refreshed every 30 minutes, and immediately when first discovered. Owners are rediscovered every minute; an owner without feeds stops being scheduled.
- FD-SCHED-2 Within one owner, feeds are refreshed one after another.
- FD-SCHED-3 At most one refresh job per owner is queued or running. Three jobs run in parallel across owners.
- FD-SCHED-4 A feed that fails to refresh is logged and does not stop the others. A `FeedNotFound` during the run is ignored, because the feed may have just been removed.
- FD-SCHED-5 A failed refresh is not visible to the user. No status is stored.

### FD-LIST — List items

Input: `owner`, optional `feedId`, `unreadOnly`, `limit` (page size, supplied by the caller), optional `cursor`.

- FD-LIST-1 With a `feedId`, the feed is looked up for this owner first. If it does not exist, fail `FeedNotFound`. Without a `feedId`, items of all of the owner's feeds are listed and no feed is looked up.
- FD-LIST-2 Order is `publishedAt` descending, then `id` descending, across all selected feeds.
- FD-LIST-3 `unreadOnly = true` returns only unread items; `false` returns all. There is no "read only" view.
- FD-LIST-4 The result holds at most `limit` items. The repository is asked for `limit + 1` to learn whether a next page exists.
- FD-LIST-5 The result carries `cursor`, `null` when there is no next page.
- FD-LIST-6 The cursor is a position, `{ publishedAt, id }`, as in CM-PAGE. Changing the feed scope or `unreadOnly` starts a new list: the caller lists again with no cursor.
- FD-LIST-7 A cursor whose item was deleted is still valid, because it holds the position.
- FD-LIST-8 There is no refresh operation and no background refresh. To see current data the caller lists again from the first page.
- FD-LIST-9 Feeds themselves are listed by title ascending, then id ascending.

### FD-OPEN — Find one item

- FD-OPEN-1 `find(owner, id)` returns `Option.some(item)` or `Option.none()`. A missing item is a normal result, not an error.
- FD-OPEN-2 An item of another owner is reported as missing.
- FD-OPEN-3 No feed is looked up.

### FD-EXTRACT — Extract an item's article

1. Find the item for this owner, else `FeedItemNotFound`.
2. If it already has `extractedContent`, return the item. Nothing is fetched.
3. If it has no URL, fail `FeedItemMissingUrl`.
4. Fetch and extract the page from its URL (shared flow).
5. Store the content as `extractedContent` and return the updated item. If the item vanished in between, fail `FeedItemNotFound`.

- FD-EXTRACT-1 Extraction failure or empty content fails the operation and stores nothing.
- FD-EXTRACT-2 Extraction runs once per item. Later requests reuse the stored content.

### FD-READ — Read state

Each is a single port call, so there is no use case. They are listed separately because callers need them distinct:

| Operation               | Effect                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Mark items (by id list) | Sets `read` on exactly those items. Used for single items and "the items loaded in the list" |
| Mark feeds              | Sets `read = true` on every item of the given feeds                                          |

- FD-READ-1 Marking unknown ids, or ids of another owner, succeeds and changes nothing.
- FD-READ-2 Marking feeds affects only feeds of the owner. Feed ids that are not the owner's are ignored.
- FD-READ-3 "Mark every subscription article read" is "mark feeds" with all of the owner's feed ids.
- FD-READ-4 "Mark all unread articles read" across the library is not a Feed operation. The caller invokes this domain's operations and the SavedPage domain's "mark all" separately.
- FD-READ-5 Marking is idempotent.

### FD-COUNT — Unread counts

- FD-COUNT-1 `unreadCounts(owner)` returns, per feed of the owner, the number of unread items. A feed with no unread items may be absent; absent means 0.
- FD-COUNT-2 The total is the sum over feeds.

### FD-UNSUB — Unsubscribe

- FD-UNSUB-1 Removes the listed feeds of the owner and, with them, all their items.
- FD-UNSUB-2 Ids that do not exist, or belong to another owner, succeed and change nothing.
- FD-UNSUB-3 Saved pages created from the feed's items stay.
- FD-UNSUB-4 Unread counts no longer include the removed feeds.

### FD-OWN — Ownership

- FD-OWN-1 Every operation is scoped to the owner passed in; the owner comes from the session at the boundary.
- FD-OWN-2 `FeedNotFound` is raised only by listing the items of one feed (FD-LIST-1) and by refresh (FD-REFRESH step 1). Every other operation treats an unknown feed or item as "nothing there".

## Use cases

| Operation                                                         | Use case? | Why                                                         |
| ----------------------------------------------------------------- | --------- | ----------------------------------------------------------- |
| `fetchParsedFeed`                                                 | helper    | Shared by preview, subscribe and refresh                    |
| Preview a subscription                                            | Yes       | Helper, then project the result                             |
| Subscribe                                                         | Yes       | Duplicate check, helper, create, initial import             |
| Refresh a feed (scheduled)                                        | Yes       | Helper, selection, import, trim, update                     |
| List items                                                        | Yes       | Feed lookup for one feed, `unreadOnly`, next-page detection |
| Extract an item                                                   | Yes       | Reuse or fetch, store                                       |
| Find one item, mark items, mark feeds, unread counts, unsubscribe | No        | One port call each                                          |

Errors: `FeedExists`, `FeedNotFound`, `FeedItemNotFound`, `FeedItemMissingUrl`, `FeedImportFailed`, `FetchFeedError`, `FeedParserError`, `ArticleEmptyContent`, webpage fetch and article extraction errors from the shared flow, `FeedRepositoryError`, `FeedItemRepositoryError`.

## Ports

### FeedRepository

All methods are scoped by `ownerId`.

| Method                   | Contract                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `find(owner, id)`        | `Option` of the feed                                                                                     |
| `list(owner)`            | The owner's feeds ordered by title, then id                                                              |
| `create(owner, feeds)`   | Returns the ids actually created. A feed whose id, or whose URL, already exists for the owner is skipped |
| `remove(owner, ids)`     | Removes the owner's feeds among `ids` **and all their items**; unknown ids ignored                       |
| `update(owner, updates)` | Applies a patch (`title`, `updatedAt`) to the owner's feeds                                              |

### FeedItemRepository

| Method                                                | Contract                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `find(owner, id)`                                     | `Option` of the item                                                                                                                  |
| `list(owner, { feedId?, unreadOnly, after?, limit })` | Items ordered by `publishedAt` desc, `id` desc; strictly after `after` when given; at most `limit`; restricted to `feedId` when given |
| `create(items)`                                       | Returns the ids actually created. An existing id is skipped, never overwritten                                                        |
| `update(owner, ids, patch)`                           | Applies a patch (`read`, `extractedContent`) to the owner's items among `ids`; returns the ids updated; unknown ids ignored           |
| `updateByFeeds(owner, feedIds, patch)`                | Applies a patch to every item of the owner's feeds among `feedIds`                                                                    |
| `unreadCounts(owner)`                                 | Unread count per feed of the owner                                                                                                    |
| `inventory(owner, feedId)`                            | `(id, publishedAt)` of every stored item of the feed                                                                                  |
| `retain(owner, feedId, ids)`                          | Deletes every item of the feed whose id is not in `ids`; all items if `ids` is empty                                                  |

`unreadOnly` is a plain boolean parameter. There is no separate read-filter type.

## Shared (decided here, to be specified in the shared section)

- Fetch and extract a page from a URL: fetch through the webpage port, parse, extract the article, fail `ArticleEmptyContent` when content is empty. Used by FD-EXTRACT and by the SavedPage domain.
- List paging helpers: cursor encoding and consistency check, `limit + 1` next-page detection. Page size is always a parameter.
- Both domains use `unreadOnly: boolean` instead of a read-filter type.

The shared flows are specified in `common.md`.
