# SavedPage (read later)

Domain: pages a user saved to read later. Saved pages are independent of feed items: saving a feed item makes a copy, after which the two never affect each other.

Scope: business contract only. Front-end behavior (auto-marking a page read when opened, keeping a just-read page in the unread list, when the user reloads, request races) is in the `project-architecture` skill's `reader-ui.md`.

## Entity

| Field         | Type                         | Notes                                                                     |
| ------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `id`          | `SavedPageId`                | A new UUIDv7 (SP-ID-1)                                                    |
| `ownerId`     | `OwnerId`                    |                                                                           |
| `url`         | `NormalizedUrl`              | Required                                                                  |
| `title`       | `ArticleTitle`               |                                                                           |
| `description` | `Option<ArticleDescription>` | Sanitized                                                                 |
| `content`     | `ArticleContent`             | Required, non-empty, sanitized                                            |
| `publishedAt` | `Option<DateTimeUtc>`        | The article's publish time, if any. Display only. See SP-ADD-4, SP-SAVE-5 |
| `read`        | `boolean`                    | `false` when created                                                      |

## Rules

### SP-ID — Identity

- SP-ID-1 A saved page's id is a new id (CM-ID). Each id is larger than the ids made before it in the same process, so the newest page sorts first (CM-ID-1).
- SP-ID-2 The same URL saved by two owners gives two pages. Each owner has at most one page per normalized URL: the repository enforces that with a unique key (CM-PORT-6).
- SP-ID-3 Title, description and content do not take part in identity.
- SP-ID-4 `SavedPageRepository.findByUrl(owner, url)` returns the owner's page with that URL, or none. It is how a duplicate is found before anything is fetched (SP-ADD-1, SP-SAVE-3).

### SP-ADD — Add a link

1. `findByUrl(owner, url)` (SP-ID-4). If a page is found, fail `SavedPageAlreadyExists(url)`. Nothing is fetched.
2. `fetchAndExtract(url)` (CM-FETCH).
3. Build the page (unread); its constructor makes a new id (CM-ID-3). Create it and return it. If nothing was created, fail `SavedPageAlreadyExists(url)`.

- SP-ADD-1 A duplicate is detected before any fetching.
- SP-ADD-2 The saved `url` is the submitted normalized URL, not a redirect target.
- SP-ADD-3 Fetch, parse or extraction failure, or empty content, fails the operation and saves nothing.
- SP-ADD-4 `publishedAt` is the publish time reported by `fetchAndExtract`, or none when the page has none. A missing time stays none; nobody invents one (CM-FETCH-1).
- SP-ADD-5 If two requests add the same link at once, the unique URL key lets exactly one `create` succeed. The loser gets nothing created and fails `SavedPageAlreadyExists(url)`; no extra lookup is needed.

### SP-SAVE — Save a feed item

Input: `owner`, `itemId`.

Every feed item has a URL (see `feed.md`), so every item can be saved.

1. Find the item for this owner, else `FeedItemNotFound` (SP-SAVE-1).
2. `findByUrl(owner, item.url)`. If a page is found, fail `SavedPageAlreadyExists(url)`. Nothing is fetched.
3. Choose the content (SP-SAVE-8). `fetchAndExtract(item.url)` runs only when the item has neither extracted nor feed content.
4. Build the page (SP-SAVE-9, SP-SAVE-10); its constructor makes a new id (CM-ID-3). Create it and return it. If nothing was created, fail `SavedPageAlreadyExists(url)`.

- SP-SAVE-1 The item is looked up by owner and id only; no feed is looked up. An item that does not exist, or belongs to another owner, fails `FeedItemNotFound` and nothing is saved.
- SP-SAVE-2 The copy takes title and description from the item.
- SP-SAVE-3 Duplicate detection happens before any fetching.
- SP-SAVE-4 Saving does not change the feed item, and later changes to either side do not reach the other.
- SP-SAVE-5 `publishedAt` is the feed item's publish time, or none when the item has none.
- SP-SAVE-6 Fetch, parse or extraction failure, or empty content, fails the operation and saves nothing when the content must be fetched (SP-SAVE-8).
- SP-SAVE-7 A concurrent duplicate is handled as in SP-ADD-5: the unique URL key decides, and the loser fails `SavedPageAlreadyExists(url)`.
- SP-SAVE-8 Content priority: the item's extracted content; else its feed content; else the content of `fetchAndExtract(item.url)`. Nothing is fetched when the item has content.
- SP-SAVE-9 The copy is a new page with a new id: unread, `url` and `publishedAt` from the item (SP-SAVE-5), and its title and description from the item (SP-SAVE-2). Its id is larger than the ids of the pages saved before it in the same process, so it is on top.
- SP-SAVE-10 The item found in step 1 is used even if it is deleted (by retention or by unsubscribing) before the page is created; the save succeeds.

### SP-LIST — List

Input: `owner`, `unreadOnly`, `limit`, optional `cursor`. Paging follows CM-PAGE with `id` descending as the sort key.

- SP-LIST-1 Order is `id` descending, so the newest saved page is on top. A page just saved is at the top, however old the article is.
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
- SP-REMOVE-2 After removal the same URL can be added again: a new unread page with a new id, at the top of the list.

### SP-OPEN — Find one

- SP-OPEN-1 Returns `Option.some(page)` or `Option.none()`. A missing page is a normal result, not an error.
- SP-OPEN-2 Another owner's page is reported as missing.

### SP-COUNT — Unread count

- SP-COUNT-1 Returns the number of the owner's unread saved pages.

### SP-OWN — Ownership

- SP-OWN-1 Every operation is scoped to the owner passed in (CM-OWN).

## Use cases

| Use case         | Input                                     | Output                    | Errors (besides repository errors)                                  |
| ---------------- | ----------------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| `addSavedPage`   | `owner`, `url`                            | `SavedPage`               | `SavedPageAlreadyExists`, and those of CM-FETCH                     |
| `saveFeedItem`   | `owner`, `itemId`                         | `SavedPage`               | `FeedItemNotFound`, `SavedPageAlreadyExists`, and those of CM-FETCH |
| `listSavedPages` | `owner`, `unreadOnly`, `limit`, `cursor?` | pages, `cursor` or `null` | none                                                                |

Find one, mark by ids, mark all, remove and unread count are one port call each and have no use case.

## Errors

| Error                      | Carries          | Meaning                          | Raised by                  |
| -------------------------- | ---------------- | -------------------------------- | -------------------------- |
| `SavedPageAlreadyExists`   | normalized `url` | The owner already saved this URL | SP-ADD, SP-SAVE            |
| `SavedPageRepositoryError` | message          | Storage failure                  | `SavedPageRepository` port |

`FeedItemNotFound` belongs to the Feed domain (see `feed.md`). `ArticleEmptyContent` and the fetch and extraction errors belong to Common (CM-FETCH-4).

## Port: SavedPageRepository

All methods are scoped by `ownerId`.

| Method                                       | Contract                                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `find(owner, id)`                            | `Option` of the page                                                                                                                         |
| `findByUrl(owner, url)`                      | `Option` of the owner's page with that URL (SP-ID-4)                                                                                         |
| `list(owner, { unreadOnly, after?, limit })` | Pages ordered by `id` desc, newest saved first; those with a smaller id than `after` when given; at most `limit`                             |
| `create(owner, pages)`                       | CM-PORT: returns the ids actually created; a row is skipped, never overwritten, when its id exists or its URL is already saved for the owner |
| `update(owner, ids, patch)`                  | CM-PORT: applies `patch` to the owner's pages among `ids`; returns the ids that exist; the writable patch field is `read`                    |
| `updateAll(owner, patch)`                    | Applies `patch` to every page of the owner                                                                                                   |
| `remove(owner, ids)`                         | Removes the owner's pages among `ids`; unknown ids ignored                                                                                   |
| `unreadCount(owner)`                         | Count of unread pages                                                                                                                        |

From other domains: `FeedItemRepository.find` (Feed); `WebpageFetcher`, `HtmlParser`, `ArticleExtractor` (Common).
