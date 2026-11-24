# Saved Pages (`稍后阅读`)

Independent read-later pages added via URL, browser bookmarklet, or copied from a feed item.

## Rules

- `SP-ID-1`: Saved pages are unique per normalized URL (`CM-URL`). Saving a feed item copies its metadata/content into a new unread saved page; subsequent edits, retention pruning, or unsubscribing on the feed side never affect the saved page.
- `SP-ADD-1`: Adding a URL checks duplicates by normalized URL before fetching (`CM-FETCH-1`). On duplicate (`409 SavedPageAlreadyExists`), adding a link via dialog or `/save` opens the existing page instead of showing an error; saving an already-saved feed item shows toast `该文章已在稍后阅读中` and stays on the item.
- `SP-ADD-2`: Stored `url` is the submitted normalized URL (not a redirect target). Fetch/extract failure or empty content saves nothing.
- `SP-SAVE-1`: Saving a feed item reuses `extractedContent`, else feed `content`, and fetches (`CM-FETCH-1`) only when the item has neither. Missing item fails `404 FeedItemNotFound`.
- `SP-LIST-1`: Listed in `id DESC` order by default, or `id ASC` with `order=oldest` (`CM-PAGE-1`).
- `SP-READ-1`: Marking read/unread (`PATCH`, `POST /read`, `POST /read-all`) is idempotent; unknown IDs succeed with no change.
- `SP-REMOVE-1`: Deleting removes the row immediately. Re-adding the same URL later creates a fresh unread page at the top.

## Interface

- **Add dialog (`新增文章链接`)**: triggered from `稍后阅读` row/list menu or empty state; requires `http`/`https` URL. Shows `添加中…` while fetching; on success closes, shows `文章已添加`, and opens `/later/:pageId`.
- **Bookmarklet quick-save (`/save#url=...`, legacy `/save?url=...`)**: does **not** mutate state automatically on `GET` (preventing external link-based CSRF). Instead, it consumes the URL from `#url=` (or legacy `?url=`) into tab-scoped in-memory state, strips it from the address bar via `history.replaceState`, and pre-fills an editable URL form with a focused `确认保存` submit button (Enter or one click invokes `POST /api/saved-pages`). Redirects to `/later/:pageId` on success or duplicate (`409 SavedPageAlreadyExists`), or shows the failure inline for retry/editing. If the session is missing or expires during submit, `401 Unauthorized` redirects to `/login?next=%2Fsave` without copying the target URL into `?next` and keeps the draft in memory until returning to `/save`.
- **Feed item reader header**: `保存到稍后阅读` button saves the open item without navigating away (`已保存到稍后阅读`).
- **Delete**: `删除` in the saved-page reader overflow menu asks `window.confirm` before deleting and returning to `/later`.

## API

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/saved-pages` | `limit`, `unread`, `order?`, `cursor?` | `200 { items, cursor }` | `SavedPageRepositoryError` 500 |
| GET | `/api/saved-pages/unread-count` | — | `200 { count }` | `SavedPageRepositoryError` 500 |
| GET | `/api/saved-pages/:id` | `id` | `200 { item \| null }` | `SavedPageRepositoryError` 500 |
| POST | `/api/saved-pages` | `{ url }` | `201 { item }` | `InvalidPageUrl` 400, `SavedPageAlreadyExists` 409 `{ id, url }`, `CM-FETCH` 422, `TooManyRequests` 429, 500 |
| POST | `/api/feed-items/:id/save` | `id` | `201 { item }` | `FeedItemNotFound` 404, `SavedPageAlreadyExists` 409 `{ id, url }`, `CM-FETCH` 422, `TooManyRequests` 429, 500 |
| PATCH | `/api/saved-pages/:id` | `{ read }` | `204` | `SavedPageRepositoryError` 500 |
| POST | `/api/saved-pages/read` | `{ ids }` | `204` | `SavedPageRepositoryError` 500 |
| POST | `/api/saved-pages/read-all` | — | `204` | `SavedPageRepositoryError` 500 |
| DELETE | `/api/saved-pages/:id` | `id` | `204` | `SavedPageRepositoryError` 500 |

`SavedPage`: `{ id, url, title, description?, content, publishedAt?, read }`.

## Messages

| Code / Situation | Text |
| --- | --- |
| `InvalidPageUrl` | 请输入有效的 http 或 https 链接 |
| `SavedPageAlreadyExists` | 该文章已在稍后阅读中 |
| `SavedPageRepositoryError` | 暂时无法访问稍后阅读，请稍后重试 |
| added / saved toast | 文章已添加 / 已保存到稍后阅读 |
| empty state | 留一篇，慢慢读 / 保存感兴趣的文章链接，在这里专注阅读。 / 新增文章链接 |
| delete confirm | 删除这篇稍后阅读？删除后无法恢复。 |

## Acceptance

```gherkin
Feature: Saved pages
  Scenario: Adding an already-saved URL via dialog or /save opens the existing page
    Given "https://example.com/post" is already saved
    When I submit "https://example.com/post?utm_source=x" or open "/save#url=https%3A%2F%2Fexample.com%2Fpost"
    Then no duplicate is created and the existing page opens at "/later/<pageId>"

  Scenario: Saving a feed item that has feed content does not fetch the webpage
    Given a feed item has feed content
    When I click "保存到稍后阅读"
    Then the saved page uses the item's content without an external fetch
```
