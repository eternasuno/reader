# Background Refresh, Parsing & Retention

Feed fetching, parsing (`FD-PARSE`), item selection/retention (`FD-SEL`), sync (`FD-SYNC`), and the background scheduler (`FD-SCHED`). Normal feeds refresh silently in the background; only feeds with repeated failures surface an indicator for manual handling.

## Rules

### FD-FETCH & FD-PARSE — Fetching and Parsing
- `FD-FETCH-1`: Fetches feed URLs with SSRF IP filtering (`CM-FETCH-2`), redirect re-validation, `15s` timeout, and `10 MiB` max body. Non-2xx fails `FetchFeedError`; invalid feed fails `FeedParserError`. Entry URLs resolve against the final response URL.
- `FD-PARSE-1`: Supports RSS, Atom, RDF, and JSON Feed (stripping leading UTF-8 BOM). Failure is total.
- `FD-PARSE-2`: Entry URL takes RSS/RDF `link`, JSON Feed `url` (ignoring `external_url`), or Atom `rel="alternate"` (preferring `text/html`, then untyped, then any alternate). Entries missing a valid `http`/`https` `NormalizedUrl` are dropped silently.
- `FD-PARSE-3`: Plain text summaries/contents in Atom (`text`, `text/plain`, untyped) and JSON Feed (`summary`, `content_text`) are HTML-escaped before sanitization. RSS/RDF use `content:encoded` for content (never `description` as content); Atom ignores `content[src]`; JSON Feed prefers non-blank `content_html` over `content_text`.
- `FD-PARSE-4`: Publish time uses RSS `pubDate`, Atom `published` (ignoring `updated`), RDF `dc:date`, or JSON Feed `date_published` (ignoring `date_modified`). Unparseable or missing dates remain absent.
- `FD-PARSE-5`: Feed title falls back to `baseUrl` host when empty.

### FD-SEL & FD-SYNC — Selection, Retention & Sync
- `FD-SEL-1`: Let `N` be the global retention setting (`SET-VAL-1`, default `100`). Take the first `N` distinct entries from the source in source order (collapsing duplicate URLs to the first occurrence).
- `FD-SEL-2`: Entries not yet stored are imported; already stored entries keep their original id, content, and read state (`FD-SYNC-1`).
- `FD-SEL-3`: Retained items = stored items present in the top `N` source entries + remaining stored items (newest first) up to `N` total, ignoring read state. All other stored items of that feed are deleted.
- `FD-SEL-4`: New items in a sync are assigned monotonically increasing IDs from last listed to first so the source's newest/first entry gets the largest ID and sorts on top.
- `FD-SYNC-1`: Imported source fields (`url`, `title`, `description`, `content`, `publishedAt`) of stored items are immutable across refreshes (`read` and `extractedContent` remain mutable). Failed HTML sanitization skips only that bad entry and logs it. On success, feed `title` and `updatedAt` are updated, `failureCount` resets to `0`, and `lastError` is cleared.

### FD-SCHED — Refresh Queue & Scheduler
- `FD-SCHED-1`: Enqueues every feed once at startup and on a fixed `30 minutes` interval, plus immediately upon subscription or OPML import.
- `FD-SCHED-2`: At most one refresh runs per feed at a time (duplicate enqueues while running are dropped). Refreshes across feeds run through a bounded worker pool (default concurrency `5`).
- `FD-SCHED-3`: On a refresh failure, `failureCount` increments by 1 and a sanitized summary is saved in `lastError` (never exposing internal stack traces or credentials). Once `failureCount >= 3`, the UI shows a warning indicator on that feed so the user can inspect the error, manually trigger a retry (`POST /api/feeds/:id/refresh`), or unsubscribe. Below 3 consecutive failures, failures remain silent in the UI.

## Acceptance

```gherkin
Feature: Selection and retention (N = 3)
  Scenario Outline: Pure selection preserves existing positions and prunes oldest unlisted items
    Given stored items (top to bottom) are "<stored>"
    And source lists (top to bottom) "<source>"
    When selection runs with N = 3
    Then resulting stored items (top to bottom) are "<after>"

    Examples:
      | stored | source  | after |
      |        | d c b a | d c b |
      | d c b  | e d c b | e d c |
      | e d c  | f       | f e d |
      | e d c  | c e d   | e d c |
      | e d c  | e x d c | x e d |
```
