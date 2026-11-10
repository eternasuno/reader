# SavedPage (read later)

Domain: pages a user saved to read later. Saved pages are independent of feed items: saving a feed item makes a copy, after which the two never affect each other.

Scope: business contract only. Front-end behavior (auto-marking a page read when opened, keeping a just-read page in the unread list, when the user reloads, request races) is not specified here.

## Entity

| Field         | Type                         | Notes                                                   |
| ------------- | ---------------------------- | ------------------------------------------------------- |
| `id`          | `SavedPageId`                | `hashId(owner, url.href)` (SP-ID-1)                     |
| `ownerId`     | `OwnerId`                    |                                                         |
| `url`         | `NormalizedUrl`              | Required                                                |
| `title`       | `ArticleTitle`               |                                                         |
| `description` | `Option<ArticleDescription>` | Sanitized                                               |
| `content`     | `ArticleContent`             | Required, non-empty, sanitized                          |
| `publishedAt` | `DateTimeUtc`                | When the article was published. See SP-ADD-4, SP-SAVE-5 |
| `savedAt`     | `DateTimeUtc`                | When the page was saved. The list is ordered by it      |
| `read`        | `boolean`                    | `false` when created                                    |

## Rules

### SP-ID — Identity

- SP-ID-1 A saved page's id is `hashId(owner, url.href)`. Two saved pages of one owner with the same normalized URL are the same page.
- SP-ID-2 The same URL saved by two owners gives two pages.
- SP-ID-3 Title, description and content do not take part in identity.

### SP-ADD — Add a link

1. Compute `id = hashId(owner, url.href)`.
2. If the owner already has that id, fail `SavedPageAlreadyExists(id)`. Nothing is fetched.
3. `fetchAndExtract(url)` (CM-FETCH).
4. Create the page with `savedAt = now` and return it.

- SP-ADD-1 A duplicate is detected before any fetching.
- SP-ADD-2 The saved `url` is the submitted normalized URL, not a redirect target.
- SP-ADD-3 Fetch, parse or extraction failure, or empty content, fails the operation and saves nothing.
- SP-ADD-4 `publishedAt` is the extracted publish time; when the page has none it is the time of adding (CM-FETCH-1).
- SP-ADD-5 If two requests add the same link at once, `create` reports that nothing was created for the loser, which fails `SavedPageAlreadyExists(id)`.

### SP-SAVE — Save a feed item

Input: `owner`, `itemId`.

1. Find the item for this owner, else `FeedItemNotFound`. No feed is looked up.
2. If the item has no URL, fail `FeedItemMissingUrl`.
3. Compute `id = hashId(owner, item.url.href)`. If the owner already has it, fail `SavedPageAlreadyExists(id)`. Nothing is fetched.
4. Pick the content: the item's extracted content; else its feed content; else the content of `fetchAndExtract(item.url)`.
5. Create the page with `savedAt = now` and return it.

- SP-SAVE-1 Feed items without a URL cannot be saved.
- SP-SAVE-2 The copy takes title and description from the item.
- SP-SAVE-3 Duplicate detection happens before any fetching.
- SP-SAVE-4 Saving does not change the feed item, and later changes to either side do not reach the other.
- SP-SAVE-5 `publishedAt` is the feed item's publish time.
- SP-SAVE-6 Extraction failure or empty content in step 4 fails the operation and saves nothing.
- SP-SAVE-7 A concurrent duplicate is handled as in SP-ADD-5.

### SP-LIST — List

Input: `owner`, `unreadOnly`, `limit`, optional `cursor`. Paging follows CM-PAGE with `savedAt` as the sort time.

- SP-LIST-1 Order is `savedAt` descending, then `id` descending. A page just saved is at the top, however old the article is.
- SP-LIST-2 Only the owner's pages are ever returned.
- SP-LIST-3 Listing again from the first page applies `unreadOnly` afresh, so pages read since are absent under `unreadOnly = true` and pages saved since are at the top.

### SP-READ — Read state

Each operation is a single port call, so there is no use case. They are listed separately because callers need them distinct:

| Operation               | Port call                      | Effect                                                                                       |
| ----------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| Mark pages (by id list) | `update(owner, ids, { read })` | Sets `read` on exactly those pages. Used for "the pages loaded in the list" and single pages |
| Mark all                | `updateAll(owner, { read })`   | Sets `read` on every page of the owner, loaded or not                                        |

- SP-READ-1 Marking unknown ids, or ids of another owner, succeeds and changes nothing.
- SP-READ-2 Marking is idempotent.
- SP-READ-3 "Mark all unread articles read" across the library is not a SavedPage operation. The caller invokes this domain's "mark all" and the Feed domain's "mark all" separately.

### SP-REMOVE — Remove

- SP-REMOVE-1 Removes the listed pages of the owner. Unknown ids, or ids of another owner, succeed and change nothing.
- SP-REMOVE-2 After removal the same URL can be added again, as a new unread page with a new `savedAt`.

### SP-OPEN — Find one

- SP-OPEN-1 Returns `Option.some(page)` or `Option.none()`. A missing page is a normal result, not an error.
- SP-OPEN-2 Another owner's page is reported as missing.

### SP-COUNT — Unread count

- SP-COUNT-1 Returns the number of the owner's unread saved pages.

### SP-OWN — Ownership

- SP-OWN-1 Every operation is scoped to the owner passed in (CM-OWN).

## Use cases

| Use case         | Input                                     | Output                    | Errors (besides repository errors)                                                        |
| ---------------- | ----------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| `addSavedPage`   | `owner`, `url`                            | `SavedPage`               | `SavedPageAlreadyExists`, and those of CM-FETCH                                           |
| `saveFeedItem`   | `owner`, `itemId`                         | `SavedPage`               | `FeedItemNotFound`, `FeedItemMissingUrl`, `SavedPageAlreadyExists`, and those of CM-FETCH |
| `listSavedPages` | `owner`, `unreadOnly`, `limit`, `cursor?` | pages, `cursor` or `null` | none                                                                                      |

Find one, mark by ids, mark all, remove and unread count are one port call each and have no use case.

## Errors

| Error                      | Carries                   | Meaning                          | Raised by                  |
| -------------------------- | ------------------------- | -------------------------------- | -------------------------- |
| `SavedPageAlreadyExists`   | `id` of the existing page | The owner already saved this URL | SP-ADD, SP-SAVE            |
| `SavedPageRepositoryError` | message                   | Storage failure                  | `SavedPageRepository` port |

`FeedItemNotFound` and `FeedItemMissingUrl` belong to the Feed domain (see `feed.md`). `ArticleEmptyContent` and the fetch and extraction errors belong to Common (CM-FETCH-4).

## Port: SavedPageRepository

All methods are scoped by `ownerId`.

| Method                                       | Contract                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `find(owner, id)`                            | `Option` of the page                                                                           |
| `list(owner, { unreadOnly, after?, limit })` | Pages ordered by `savedAt` desc, `id` desc; strictly after `after` when given; at most `limit` |
| `create(owner, pages)`                       | Returns the ids actually created. An existing id is skipped, never overwritten                 |
| `update(owner, ids, patch)`                  | Applies `patch` to the owner's pages among `ids`; returns the ids updated; unknown ids ignored |
| `updateAll(owner, patch)`                    | Applies `patch` to every page of the owner                                                     |
| `remove(owner, ids)`                         | Removes the owner's pages among `ids`; unknown ids ignored                                     |
| `unreadCount(owner)`                         | Count of unread pages                                                                          |

From other domains: `FeedItemRepository.find` (Feed); `WebpageFetcher`, `HtmlParser`, `ArticleExtractor` (Common).
