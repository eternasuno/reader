# SavedPage (read later)

Domain: pages a user saved to read later. Saved pages are independent of feed items: saving a feed item makes a copy, after which the two never affect each other.

Scope: business contract only. Front-end behavior (auto-marking a page read when opened, keeping a just-read page in the unread list, when background refresh runs, request races) is not specified here.

## Entity

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `SavedPageId` | `hash(owner, url)` |
| `ownerId` | `OwnerId` | |
| `url` | `NormalizedUrl` | Required. Tracking parameters and the fragment are removed by the entity's conversion, not by use cases |
| `title` | `ArticleTitle` | Empty becomes "Untitled" |
| `description` | `Option<ArticleDescription>` | |
| `content` | `ArticleContent` | Required, non-empty |
| `publishedAt` | `DateTimeUtc` | See SP-ADD-4 and SP-SAVE-5 |
| `read` | `boolean` | `false` when created |

Parsing and validation happen only at the boundary. Past it, branded values are trusted.

## Rules

### SP-ID — Identity

- SP-ID-1 Two saved pages of one owner with the same normalized URL are the same page.
- SP-ID-2 The same URL saved by two owners gives two pages.
- SP-ID-3 Title, description and content do not take part in identity.

### SP-ADD — Add a link

1. Compute `id = hash(owner, url)`.
2. If the owner already has that id, fail `DuplicateSavedPage(id)`. Nothing is fetched.
3. Fetch and extract the page (shared flow, see Shared).
4. Create the page and return it.

- SP-ADD-1 A duplicate is detected before any fetching.
- SP-ADD-2 The saved `url` is the submitted normalized URL, not a redirect target.
- SP-ADD-3 Fetch, parse or extraction failure, or empty content, fails the operation and saves nothing.
- SP-ADD-4 `publishedAt` is the extracted publish time; when the page has none it is the time of adding.
- SP-ADD-5 If two requests add the same link at once, `create` reports that nothing was created for the loser, which fails `DuplicateSavedPage(id)`.

### SP-SAVE — Save a feed item

1. Require the feed for this owner, else `FeedNotFound`.
2. Find the item in the feed, else `FeedItemNotFound`.
3. If the item has no URL, fail `FeedItemMissingUrl`.
4. Compute `id = hash(owner, item.url)`. If the owner already has it, fail `DuplicateSavedPage(id)`. Nothing is fetched.
5. Pick the content: the item's extracted content; else its feed content; else the content extracted from its URL (shared flow).
6. Create the page and return it.

- SP-SAVE-1 Feed items without a URL cannot be saved.
- SP-SAVE-2 The copy takes title and description from the item.
- SP-SAVE-3 Duplicate detection happens before any fetching.
- SP-SAVE-4 Saving does not change the feed item, and later changes to either side do not reach the other.
- SP-SAVE-5 `publishedAt` is the feed item's publish time.
- SP-SAVE-6 Extraction failure or empty content in step 5 fails the operation and saves nothing.

### SP-LIST — List

Input: `owner`, `unreadOnly`, `limit` (page size, supplied by the caller), optional `cursor`.

- SP-LIST-1 Order is `publishedAt` descending, then `id` descending.
- SP-LIST-2 `unreadOnly = true` returns only unread pages; `false` returns all pages. There is no "read only" view.
- SP-LIST-3 The result holds at most `limit` pages. The repository is asked for `limit + 1` to learn whether a next page exists.
- SP-LIST-4 The result carries `cursor`, which is `null` when there is no next page, and `boundary`, the position of the last returned page.
- SP-LIST-5 Cursor content: `owner`, `unreadOnly`, `publishedAt`, `id`. A cursor whose `owner` or `unreadOnly` differs from the request fails `InvalidCursor`.
- SP-LIST-6 A cursor whose page was deleted is still valid, because it holds the position, not a lookup key.
- SP-LIST-7 Only the owner's pages are ever returned.

### SP-REFRESH — Refresh the list

Input: `owner`, `unreadOnly`, `through` (a boundary from an earlier list result).

- SP-REFRESH-1 Returns every page from the top of the list through `through`, in list order, under the current `unreadOnly`.
- SP-REFRESH-2 The filter is applied again. A page that became read since is absent under `unreadOnly = true`, and pages saved since appear at the top.
- SP-REFRESH-3 `through` is validated like a cursor (SP-LIST-5) and fails `InvalidCursor` on mismatch.
- SP-REFRESH-4 When to refresh is the caller's decision.

### SP-READ — Read state

Each operation is a single port call, so there is no use case. They are listed separately because callers need them distinct:

| Operation | Effect |
| --- | --- |
| Mark pages (by id list) | Sets `read` on exactly those pages. Used for "the pages loaded in the list" and single pages |
| Mark all | Sets `read = true` on every page of the owner, loaded or not |

- SP-READ-1 Marking unknown ids, or ids of another owner, succeeds and changes nothing.
- SP-READ-2 Marking is idempotent.
- SP-READ-3 "Mark all unread articles read" across the library is not a SavedPage operation. The caller invokes this domain's "mark all" and the Feed domain's own operations separately.

### SP-REMOVE — Remove

- SP-REMOVE-1 Removes the listed pages of the owner. Unknown ids, or ids of another owner, succeed and change nothing.
- SP-REMOVE-2 After removal the same URL can be added again, as a new unread page.

### SP-OPEN — Find one

- SP-OPEN-1 Returns `Option.some(page)` or `Option.none()`. A missing page is a normal result, not an error.
- SP-OPEN-2 Another owner's page is reported as missing.

### SP-COUNT — Unread count

- SP-COUNT-1 Returns the number of the owner's unread saved pages.

### SP-OWN — Ownership

- SP-OWN-1 Every operation is scoped to the owner passed in; the owner comes from the session at the boundary.

## Use cases

| Operation | Use case? | Why |
| --- | --- | --- |
| Add a link | Yes | Duplicate check, fetch and extract, create |
| Save a feed item | Yes | Reads the Feed domain through its ports, duplicate check, content choice, create |
| List | Yes | Cursor check, unread filter, next-page detection |
| Refresh | Yes | Cursor check, through query |
| Find one, mark by ids, mark all, remove, unread count | No | One port call each |

Errors: `DuplicateSavedPage`, `FeedNotFound`, `FeedItemNotFound`, `FeedItemMissingUrl`, `ArticleEmptyContent`, webpage fetch and article extraction errors from the shared flow, `InvalidCursor`, `SavedPageRepositoryError`.

## Port: SavedPageRepository

All methods are scoped by `ownerId`.

| Method | Contract |
| --- | --- |
| `find(owner, id)` | `Option` of the page |
| `list(owner, { unreadOnly, after?, limit })` | Pages ordered by `publishedAt` desc, `id` desc; strictly after `after` when given; at most `limit` |
| `listThrough(owner, { unreadOnly, through })` | Every page from the top through `through` inclusive, same order |
| `create(pages)` | Returns the ids actually created. An existing id is skipped, never overwritten |
| `update(owner, ids, patch)` | Applies `patch` to the owner's pages among `ids`; returns the ids updated; unknown ids ignored |
| `updateAll(owner, patch)` | Applies `patch` to every page of the owner |
| `remove(owner, ids)` | Removes the owner's pages among `ids`; unknown ids ignored |
| `unreadCount(owner)` | Count of unread pages |

`unreadOnly` is a plain boolean parameter. There is no separate read-filter type.

## Shared (decided here, to be specified in the shared section)

- Fetch and extract a page from a URL: fetch through the webpage port, parse, extract the article, fail `ArticleEmptyContent` when content is empty. Also used by the Feed domain's on-demand extraction.
- List paging helpers: cursor encoding and consistency check, `limit + 1` next-page detection. Page size is always a parameter. Feed uses the same helpers with its own cursor scope.
- Both domains use `unreadOnly: boolean` instead of a read-filter type.
