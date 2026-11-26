# Background Refresh, Parsing & Retention

Feed fetching, parsing (`FD-PARSE`), item selection/retention (`FD-SEL`), sync (`FD-SYNC`), and the background scheduler (`FD-SCHED`). Normal feeds refresh silently in the background; only feeds with repeated failures surface an indicator for manual handling.

## Rules

### FD-FETCH & FD-PARSE — Fetching and Parsing
- `FD-FETCH-1`: Fetches feed URLs with SSRF IP filtering (`CM-FETCH-2`), redirect re-validation, `15s` timeout, and `10 MiB` max body. Non-2xx fails `FetchFeedError`; invalid feed fails `FeedParserError`. Entry URLs resolve against the final response URL.
- `FD-PARSE-1`: Supports RSS, Atom, RDF, and JSON Feed (stripping leading UTF-8 BOM), bounded to at most 1000 items, XML nesting depth `<= 64`, and a `40 MiB` cumulative sanitized output budget. Failure is total.
- `FD-PARSE-2`: Entry URL takes RSS/RDF `link`, JSON Feed `url` (ignoring `external_url`), or Atom `rel="alternate"` (preferring `text/html`, then untyped, then any alternate). Entries missing a valid `http`/`https` `NormalizedUrl` are dropped silently.
- `FD-PARSE-3`: Plain text summaries/contents in Atom (`text`, `text/plain`, untyped) and JSON Feed (`summary`, `content_text`) are HTML-escaped before sanitization. RSS/RDF use `content:encoded` for content (never `description` as content); Atom ignores `content[src]`; JSON Feed prefers non-blank `content_html` over `content_text`.
- `FD-PARSE-4`: Publish time uses RSS `pubDate`, Atom `published` (ignoring `updated`), RDF `dc:date`, or JSON Feed `date_published` (ignoring `date_modified`). Unparseable or missing dates remain absent.
- `FD-PARSE-5`: Feed title falls back to `baseUrl` host when empty.
- `FD-PARSE-6`: Feed icon is RSS/RDF `<image><url>`, Atom `icon` then `logo`, or JSON Feed `favicon` then `icon`; relative values resolve against `baseUrl`, only credential-free `http`/`https` URLs up to 2048 bytes are kept, otherwise the icon is absent. Each successful refresh replaces the stored `iconUrl`. Feed site URL (`siteUrl`) is the RSS/RDF channel `<link>`, the Atom feed-level `rel="alternate"` link, or JSON Feed `home_page_url`, with the same normalization (resolved against `baseUrl`, credential-free `http`/`https`, up to 2048 bytes, otherwise absent), and each successful refresh replaces the stored `siteUrl` too.

### FD-SEL & FD-SYNC — Selection, Retention & Sync
- `FD-SEL-1`: Let `N` be the global retention setting (`SET-VAL-1`, default `100`). Take the first `N` distinct entries from the source in source order (collapsing duplicate URLs to the first occurrence).
- `FD-SEL-2`: Entries not yet stored are imported; already stored entries keep their original id, content, and read state (`FD-SYNC-1`).
- `FD-SEL-3`: Retained items = stored items present in the top `N` source entries + remaining stored items (newest first) up to `N` total, ignoring read state. All other stored items of that feed are deleted.
- `FD-SEL-4`: New items in a sync are assigned monotonically increasing IDs from last listed to first so the source's newest/first entry gets the largest ID and sorts on top.
- `FD-SYNC-1`: Imported source fields (`url`, `title`, `description`, `content`, `publishedAt`) of stored items are immutable across refreshes (`read` and `extractedContent` remain mutable). Failed HTML sanitization skips only that bad entry and logs it. On success, feed `title`, `siteUrl`, and `iconUrl` are updated and a succeeded refresh attempt is recorded in `feed_refresh` in the same transaction, which makes `updatedAt` current, resets `failureCount` to `0`, and clears `lastError` (all derived, `FD-SCHED-3`).

### FD-SCHED — Refresh Queue & Scheduler
- `FD-SCHED-1`: Enqueues every feed once at startup and on a fixed `30 minutes` interval, plus immediately upon subscription or OPML import.
- `FD-SCHED-2`: At most one refresh runs per feed at a time (duplicate enqueues while running are dropped). Refreshes across feeds run through a bounded worker pool (default concurrency `5`).
- `FD-SCHED-3`: Every finished external refresh attempt, success or failure (fetch or parse), is recorded in `feed_refresh` with its start and finish time; a failed attempt carries a sanitized summary (never exposing internal stack traces or credentials). Each feed keeps its newest `10` attempts, plus its newest success when that falls outside those `10`. A feed's `updatedAt` (finish time of its newest success), `failureCount` (failed attempts newer than that success), and `lastError` (the newest attempt's summary, only when it failed) are derived from these records; the feed API shape is unchanged. Once `failureCount >= 3`, the UI shows a warning indicator on that feed so the user can inspect the error, manually trigger a retry (`POST /api/feeds/:id/refresh`), or unsubscribe. Below 3 consecutive failures, failures remain silent in the UI. Database errors in the refresh path are logged without recording an attempt (so `failureCount` and `lastError` are unchanged), and `3` consecutive database failures make the process exit non-zero.

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
