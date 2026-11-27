# Feeds, Feed Items & OPML

Feed subscriptions, feed-item scopes, OPML import/export, per-feed reading preferences, and item extraction. Background refresh and parsing are in [feeds-refresh.md](feeds-refresh.md); folders in [folders.md](folders.md).

## Rules

- `FD-ID-1`: Feeds are unique per normalized URL (`CM-URL`). Items are unique per `(feedId, url)`.
- `FD-PREVIEW-1`: Preview fetches and parses the source without storing anything, returning `{ url, title, description?, titles }`.
- `FD-SUB-1`: Subscribe stores `{ url, title, folderId? }` with defaults `readerMode = "default"`, `order = "newest"`, returns `201 { item }` immediately, and makes the feed due for an immediate background refresh (`FD-SCHED-1`). Duplicate URL fails `409 FeedAlreadyExists(url)`; missing `folderId` fails `404 FolderNotFound`.
- `FD-SUB-2`: After subscribing, the client opens the new feed and, while that feed's list is still shown and empty, polls `GET /api/feeds` every 2 s (at most 15 times) until the feed's first refresh finishes (`updatedAt` present or `failureCount > 0`), then refreshes the sidebar and reloads the list (an exception to `LIB-RELOAD-1`). A failed poll request is retried within that budget. Each check ends the wait once the feed was shown and another scope (or no library page) is shown, or rows arrived; the sidebar refresh and reload also require the feed to still be shown and empty.
- `FD-OPML-1`: **OPML export** (`GET /api/opml`) outputs an OPML 2.0 XML document containing folders as grouping `<outline text="...">` elements and feeds as `<outline type="rss" text="..." title="..." xmlUrl="..."/>`, ordered by folder name then feed title. Any `user:pass@` URL credentials are stripped from `xmlUrl` (`CM-URL-5`).
- `FD-OPML-2`: **OPML import** (`POST /api/opml`) parses and validates the XML document completely in memory first (bounded to `<= 2000` `<outline>` elements and XML nesting depth `<= 64`); malformed or oversized XML returns `400 InvalidOpml` with **zero** DB writes or refresh wake-ups. Nested folder outlines flatten to the **innermost parent folder** (or top level if none). Inside one DB transaction, missing folders are created by trimmed name, valid `http`/`https` `xmlUrl` feeds are subscribed, and duplicates (`NormalizedUrl` already followed) plus invalid `xmlUrl` outlines are skipped and counted in `skippedFeeds`. Newly created feeds are created due for refresh (`FD-SCHED-1`) and refresh workers are woken after commit.
- `FD-PREF-1`: Each feed stores `readerMode` (`default` | `extracted`; any other value, including `embedded`, fails `400 RequestFailed`) and `order` (`newest` | `oldest`). `order` applies to every item list: `全部订阅`, folders, `稍后阅读`, and the single feed. Only the single-feed list has a stored order (used when the `order` query is absent); for the other lists the client persists the choice and the server just honors the `order` query, defaulting to `newest` (`id DESC`). Changing `order` on the active list resets its cursor and reloads page 1 in the new order.
- `FD-LIST-1`: Feeds list by `(title ASC, id ASC)` in UTF-8 byte order. Item lists (`全部订阅`, single feed, folder) use `CM-PAGE-1`. Unknown `feedId`/`folderId` returns an empty page.
- `FD-EXTRACT-1`: `POST /api/feed-items/:id/extract` returns cached `extractedContent` if present, otherwise runs `CM-FETCH-1`, stores `extractedContent`, and returns the updated item (coalescing concurrent requests for the same item and rejecting new foreground fetches with `429 TooManyRequests` when fetch capacity is exhausted). Missing item fails `404 FeedItemNotFound`.
- `FD-READ-1`: Marking items, feeds, folders, or all read is idempotent; unknown IDs succeed with no change.
- `FD-COUNT-1`: `unreadCounts` returns `{ feedId, count }` for feeds with unread items > 0 (absent = 0).
- `FD-UNSUB-1`: Unsubscribing removes the feed and cascades to its items; saved pages copied from those items stay (`SP-ID-1`). From either delete entry point (sidebar feed menu or single-feed list menu) the client shows `订阅源已删除`, reloads an active `全部订阅` or folder list from page 1 (an exception to `LIB-RELOAD-1`, discarding in-flight pages), and closes an open article from that feed; the reload and navigation are skipped if the user has left the library meanwhile.

## Interface

- **Subscribe dialog (`新增 RSS 订阅`)**: step 1 submits URL to `预览订阅` (`获取预览…`); step 2 shows title, description, up to 3 entry titles, optional `目录` select (`不放入目录` default), `确认订阅` (`订阅中…`), and `返回修改`. On `409 FeedAlreadyExists`, closes dialog, shows `该订阅已存在` toast, and navigates to the existing feed.
- **OPML import/export**: `导入 OPML` available in sidebar `+` menu and **Settings → 文章与订阅**; `导出 OPML` downloads `subscriptions.opml` from **Settings → 文章与订阅**. Import opens a file picker (`.opml,.xml`) and reports a summary toast (`已导入 N 个订阅源，跳过 M 个`).
- **Feed menu & single-feed list menu**: `全部标记为已读`, `发送电子书`, `从旧到新` checkbox (top level, no `视图选项` sub-panel and no `刷新` item; the `全部订阅`, folder, and `稍后阅读` menus offer the same checkbox, sharing one order persisted in `localStorage` as `reader.listOrder`), `缺省视图` (an in-menu sub-panel with a back header and radio items `订阅源文本` / `网页全文` that save the feed's `readerMode` immediately; picking the current value sends nothing; there is no feed options drawer and no stored embedded view), `移动到` (always shown; an in-menu sub-panel, see `folders.md`), and `删除 RSS 源` (confirms before unsubscribing; if currently open, navigates to `/all`).
- **Feed icon** (sidebar and list rows): `iconUrl` → favicon of the `siteUrl` origin → RSS glyph; never derived from the feed URL's host (`LIB-ROW-1`).
- **Repeated refresh failure indicator**: feeds with `failureCount >= 3` (`FD-SCHED-3`) show a subtle warning icon next to their sidebar title and list heading; hovering/clicking shows the `lastError` summary with `重试刷新` (`POST /api/feeds/:id/refresh`) and `删除 RSS 源` actions.

## API

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/feeds` | — | `200 { items: Feed[] }` | `FeedRepositoryError` 500 |
| POST | `/api/feeds/preview` | `{ url }` | `200 { preview }` | `FeedUrlInvalid` 400, `FetchFeedError` 422, `FeedParserError` 422, `TooManyRequests` 429 |
| POST | `/api/feeds` | `{ url, title?, folderId? }` | `201 { item }` | `FeedUrlInvalid` 400, `FolderNotFound` 404, `FeedAlreadyExists` 409 `{ url }`, 500 |
| DELETE | `/api/feeds/:id` | `id` | `204` | `FeedRepositoryError` 500 |
| POST | `/api/feeds/:id/refresh` | `id` | `202` | `FeedRepositoryError` 500 |
| PUT | `/api/feeds/:id/reader-mode` | `{ readerMode }` | `204` | `FeedRepositoryError` 500 |
| PUT | `/api/feeds/:id/order` | `{ order }` | `204` | `FeedRepositoryError` 500 |
| GET | `/api/feeds/unread-counts` | — | `200 { items: [{ feedId, count }], boundary }` | `FeedItemRepositoryError` 500 |
| POST | `/api/feeds/:id/read-all` | `id`, `{ before }` | `204` | `RequestFailed` 400, `FeedItemRepositoryError` 500 |
| GET | `/api/feeds/:id/items` | `limit`, `unread`, `order?`, `cursor?`, `boundary?` | `200 { items, cursor, boundary }` | `RequestFailed` 400, `FeedItemRepositoryError` 500 |
| GET | `/api/feed-items` | `limit`, `unread`, `order?`, `cursor?`, `boundary?` | `200 { items, cursor, boundary }` | `RequestFailed` 400, `FeedItemRepositoryError` 500 |
| GET | `/api/feed-items/:id` | `id` | `200 { item \| null }` | `FeedItemRepositoryError` 500 |
| PATCH | `/api/feed-items/:id` | `{ read }` | `204` | `FeedItemRepositoryError` 500 |
| POST | `/api/feed-items/read` | `{ ids }` | `204` | `FeedItemRepositoryError` 500 |
| POST | `/api/feed-items/read-all` | `{ before }` | `204` | `RequestFailed` 400, `FeedItemRepositoryError` 500 |
| POST | `/api/feed-items/:id/extract` | `id` | `200 { item }` | `FeedItemNotFound` 404, `CM-FETCH` 422, `TooManyRequests` 429, 500 |
| GET | `/api/opml` | — | `200` (`text/x-opml+xml` attachment) | `FeedRepositoryError` 500 |
| POST | `/api/opml` | multipart file or XML body | `200 { importedFeeds, skippedFeeds, createdFolders }` | `InvalidOpml` 400, 500 |

## Messages

| Code / Situation | Text |
| --- | --- |
| `FeedUrlInvalid` / `FetchFeedError` / `FeedParserError` | 请输入有效的订阅地址 / 无法获取订阅内容，请稍后重试 / 无法解析订阅源，请确认地址正确 |
| `FeedAlreadyExists` / `FeedItemNotFound` | 该订阅已存在 / 文章不存在，可能已被删除 |
| `FeedRepositoryError` / `FeedItemRepositoryError` | 暂时无法访问订阅，请稍后重试 / 暂时无法访问订阅文章，请稍后重试 |
| `InvalidOpml` | 无法解析 OPML 文件，请确认格式正确 |
| subscribe success / unsubscribed / OPML imported | 订阅已添加 / 订阅源已删除 / 已导入 N 个订阅源，跳过 M 个 |
| unsubscribe confirm | 取消订阅并删除该源的文章？已保存的稍后阅读不会删除。 |
| empty `全部订阅` / empty single feed | 从一个订阅源开始 / 这个订阅源还没有文章 |

## Acceptance

```gherkin
Feature: Feeds & OPML
  Scenario: Subscribing to an already-followed feed opens it without changing its folder
    Given "Go Blog" is already subscribed at top level
    When I preview its URL, choose folder "Tech", and confirm
    Then the toast "该订阅已存在" appears, "Go Blog" opens, and it remains at top level

  Scenario: Importing OPML skips duplicates and creates missing folders
    Given I already follow "Go Blog"
    When I import an OPML containing "Tech/Go Blog" and "Tech/Rust Blog"
    Then folder "Tech" is created, "Rust Blog" is subscribed in "Tech", and "Go Blog" is skipped
```
