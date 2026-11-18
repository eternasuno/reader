# Refresh, scheduling, selection and the feed parser

What happens when a feed is refreshed: fetching the source, parsing it, choosing which entries to store, turning them into items, syncing, and the queue and scheduler that run it. The user-facing side of feeds and their items — preview, subscribe, lists, read state, unread counts, extraction — is in `feeds.md`; folders in `folders.md`; the retention setting in `settings.md`. Nothing here is a user operation: a refresh has no request of its own.

## Rules

### FD-FETCH — Fetch and parse (shared by preview and refresh)

`fetchParsedFeed(url)` fetches the source with `HttpClient` (`effect/http`) and parses it through `FeedParser`.

- FD-FETCH-1 It returns a `ParsedFeed`.
- FD-FETCH-2 Failure to fetch, including a response that is not 2xx, fails `FetchFeedError`. Failure to parse fails `FeedParserError`.
- FD-FETCH-3 It has no side effects and reads no stored data.
- FD-FETCH-4 The application provides Effect's `FetchHttpClient`, and `fetch` follows redirects; the final URL is the response's URL, the URL of the last hop. The parser resolves entry URLs against that final URL; the feed keeps the submitted URL.

### Fetching sources (no feed-fetcher port)

- `HttpClient` (`effect/http`) is not a port of this package: `fetchParsedFeed` uses Effect's service directly and sends a GET to the feed URL. The application provides Effect's plain `FetchHttpClient`; `fetch` follows redirects, and no address, size or time limit is added. Because `fetch` rejects a URL that carries a user name or password, `fetchParsedFeed` sends those credentials as a Basic authorization header and the URL without them (CM-URL-4).

### FD-PARSE — FeedParser contract

The parser reads RSS, Atom, RDF and JSON Feed. Each rule is a port contract (CM-PORT-1): every implementation must satisfy it, and the adapter tests name the rule they cover. The rules record what is taken from each format; they are not a description of the parsing library.

A media type is compared after trimming, lower-casing and dropping the parameters, so `TEXT/HTML; charset=utf-8` is `text/html`, and an absent type compares as empty. FD-PARSE-3 and FD-PARSE-4 rely on this.

- FD-PARSE-1 Input: one leading byte-order mark is removed before parsing; nothing else is trimmed or changed. Text that is not one of the four formats fails `FeedParserError`, and a failure is total: no partial feed is returned.
- FD-PARSE-2 Entry URL: RSS and RDF take the entry's `link`, JSON Feed takes `url` (`external_url` is ignored), Atom takes the alternate link of FD-PARSE-3. The value is resolved against `baseUrl` and decoded as a `NormalizedUrl` (CM-URL). An entry whose URL is missing, blank, unresolvable or not a valid `NormalizedUrl` is dropped silently; the other entries keep their source order, and equal URLs are not collapsed here (FD-SEL-1 does that).
- FD-PARSE-3 Atom entry URL: only links with no `rel` or `rel="alternate"` count. The first whose media type is `text/html` is taken; else the first with no type; else the first alternate link of any type, including `application/xhtml+xml`. An entry with no alternate link is dropped (FD-PARSE-2), even when its `id` would be a usable URL.
- FD-PARSE-4 Atom text typing: the summary and the content carry a type. Plain types (no type, `text`, `text/plain`) are HTML-escaped once (`&`, `<` and `>`; existing entities are not decoded, so `&amp;` becomes `&amp;amp;`); HTML types (`html`, `text/html`, `xhtml`, `application/xhtml+xml`) are kept as given; any other type gives none. The entry title is never escaped.
- FD-PARSE-5 JSON Feed text typing: `summary` and `content_text` are HTML-escaped as in FD-PARSE-4; `content_html` is kept as given and is the content whenever the item has one. An empty or blank `content_html` counts as absent, so the content falls back to `content_text`. RSS and RDF text (`description`, `content:encoded`) is kept as given: Atom and JSON Feed are the only formats escaped. This escaping precedes the sanitizing of CM-HTML at import and is what makes a plain-text source survive it literally.
- FD-PARSE-6 Entry content source: RSS and RDF use `content:encoded` only, never `description` as content; Atom content that carries a `src` attribute gives none (nothing is fetched); JSON Feed uses `content_html`, else `content_text`.
- FD-PARSE-7 Publish time source: RSS `pubDate` only (`dc:date` is ignored); Atom `published` only (`updated` is ignored, so an entry with only `updated` has none); RDF the first `dc:date`; JSON Feed `date_published` only (`date_modified` is ignored). A missing or unparseable value is none (FD-IMPORT-5); no field falls back to another.
- FD-PARSE-8 Feed title and description: Atom takes the `title` text and the `subtitle` text, the other formats `title` and `description`. The title is decoded as `FeedTitle`: trimmed, and the host of `baseUrl` when empty. The description is an article description (CM-ART-2, CM-ART-3).
- FD-PARSE-9 Entry title, description and content are decoded as article values (CM-ART); nothing else is normalized, cut, deduplicated or reordered.

### FD-SEL — Item selection and retention

N is the owner's retention setting (`settings.md`): any integer of at least 1. The listed entries are the first N distinct entries of the source, in the order of the source; publish times play no part. The stored list order is FD-LIST-4 (`feeds.md`).

- FD-SEL-1 The listed entries are the first N distinct entries of the source, in the order of the source. Entries with the same URL (FD-ID-2) collapse to the first one. An entry that is not among them is never imported.
- FD-SEL-2 Every listed entry is retained. One that is not stored yet (no item of the feed has its URL) is imported, whatever its publish time. One that is stored is skipped.
- FD-SEL-3 The retained set is the stored items whose URL is listed, plus the other stored items, taken in list order (FD-LIST-4) from the top, until N in total; every listed entry counts toward N, also one that will fail cleaning. Every other stored item of the feed is deleted. So the removed items are the unlisted ones at the bottom of the list. A listed entry that is skipped because it cannot be cleaned (FD-IMPORT-6) still counts toward N, so the feed may hold fewer than N items until it imports.
- FD-SEL-4 Read state plays no role, so unread items beyond N are removed like read ones.
- FD-SEL-5 An item the source no longer lists stays until FD-SEL-3 removes it.
- FD-SEL-6 An entry beyond the first N of the source (after collapsing duplicates) is never imported.
- FD-SEL-7 Lowering N takes effect at the next sync. Nothing is trimmed when the setting changes.
- FD-SEL-8 Selection is a pure function of the inventory (the `id` and `url` of each stored item), the entries in source order and N. It returns the entries to import, in source order, and the ids of the stored items to delete. A new feed is the case of an empty inventory.
- FD-SEL-9 Items are built in the order they are imported, from the last listed entry to the first, and each gets its id when it is built (CM-ID-3). So the first listed entry gets the largest id of that sync and is on top (FD-LIST-4), and the entries of one sync keep their source order. Entries that are already stored or skipped for cleaning (FD-IMPORT-6) are not built and do not disturb the others.

Example, N = 3, list order shown from top to bottom. This is an illustration of the pure selection function inside the refresh; N is any integer of at least 1, and 3 is used only to keep the table small.

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
- FD-IMPORT-5 The publish time is the one the source gives in the field FD-PARSE-7 names, if any, and is kept for display only. A missing time stays none; no fallback invents one. A time that is wrong or in the future is shown as given and changes nothing else.
- FD-IMPORT-6 An entry whose description or content cannot be cleaned (CM-HTML-4) is skipped and logged. The other entries are imported. The skipped entry is not stored, so the next sync tries it again. One bad entry never blocks a feed.
- FD-IMPORT-7 An entry whose URL is missing, or is not a valid `NormalizedUrl` after resolution against the final URL, is dropped by the parser (FD-PARSE-2) and never imported. Every stored item therefore has a URL.

### FD-SYNC — Bring a feed's items in line with its source

The sync is part of the refresh, not a use case of its own: it is the one place where items are written from a source.

1. Read the inventory of the feed, `(id, url)` of every stored item in list order, and the owner's N.
2. Select (FD-SEL): the selection function returns the entries to import, in source order, and the ids of the stored items to delete.
3. For the entries to import, from the last to the first: clean the entry with its URL as the base (FD-IMPORT), skip it if cleaning fails (FD-IMPORT-6), otherwise build the item, which makes its id (FD-SEL-9). Then create the built items in one call.
4. Delete the items whose ids step 2 returned (`FeedItemRepository.remove`). Every one of them was stored before step 3, so nothing created there is touched.
5. Record the sync: `FeedRepository.recordSync(owner, feed.id, parsed.title, now)` sets the feed's `title` and `updatedAt = now`, the only clock read of the sync.

- FD-SYNC-1 Stored items are never modified. If the source changes an entry already stored, the stored item keeps its first-imported values.
- FD-SYNC-2 The writes of steps 3 to 5 are not atomic. A failure in between may leave some entries imported, more than N items, or the old title. The next sync converges. Items are never lost beyond the retention rule.
- FD-SYNC-3 Syncing one feed never changes another feed, nor any saved page.
- FD-SYNC-4 On failure the feed's title and `updatedAt` are not updated.
- FD-SYNC-5 Items are created only while their feed exists (see `FeedItemRepository.create`). If the feed is removed while a sync is running, the sync leaves no items behind: `create` skips items of a missing feed, and `remove` and `recordSync` on a missing feed change nothing. A later subscription to the same address is a new feed with a new id (FD-UNSUB-5), and it gets its own items from its own refresh.
- FD-SYNC-6 The sync never runs twice at the same time for one feed. The refresh queue guarantees it (FD-SCHED-2); nothing else in the domain relies on concurrent syncs.

### FD-REFRESH — Refresh a feed from its source

Run only by the scheduler's refresh queue (FD-SCHED). There is no user operation to refresh a feed from its source.

1. Find the feed for this owner. If it does not exist, do nothing and succeed.
2. `fetchParsedFeed(feed.url)`.
3. Sync the feed's items with the parsed source (FD-SYNC).

- FD-REFRESH-1 A feed removed before or during the run is not an error: `find` returns none and the run is done; `create` skips items of a missing feed; `remove` and `recordSync` on a missing feed change nothing. Other failures of the run (fetch, parse, storage) are still failures and are logged.
- FD-REFRESH-2 Every run goes through the refresh queue, so no two runs of one feed overlap (FD-SCHED-2). Errors are those of FD-FETCH and of the repositories used by FD-SYNC.

### FD-SCHED — Scheduled refresh (system behavior, outside business)

The scheduler lives in the application, not in the business core. It owns the refresh queue and calls the refresh (FD-REFRESH). It is described here because the retention, subscribe and sync rules rely on it. Listing the feeds for the periodic run is the scheduler's own query, not a business port.

- FD-SCHED-1 Every refresh interval, all feeds are enqueued, and each feed is enqueued once at process start.
- FD-SCHED-2 Each feed has at most one outstanding refresh. An accepted request starts at once; a request for a feed whose refresh has not finished is dropped.
- FD-SCHED-3 Refreshes of different feeds run at the same time; there is no bound on how many. Different feeds of the same owner may refresh at the same time.
- FD-SCHED-4 A feed that fails to refresh is logged and does not stop the others.
- FD-SCHED-5 A failed refresh is not visible to the user. No status is stored besides `Feed.updatedAt`.
- FD-SCHED-6 The refresh interval is the scheduler's own configuration, not a business value:

| Value            | Default    | What it is for                                                                         |
| ---------------- | ---------- | -------------------------------------------------------------------------------------- |
| Refresh interval | 30 minutes | How stale a feed may get. Shorter means fresher items and more requests to the sources |

- FD-SCHED-7 Only two things enqueue: the periodic run (FD-SCHED-1) and subscribe (the HTTP layer enqueues a new feed right after it is created, FD-SUB in `feeds.md`). No user operation refreshes a feed.

### Known risks

- Selection trusts the source to list its newest entries first. A source that lists more than N entries with the oldest first never gets past its oldest N. Almost every source lists newest first, and most list fewer than N entries, in which case all of them are taken.
- A source that changes the order of entries already stored is not followed: stored items keep the id they arrived with, so they keep their position.
- An entry the source inserts below newer ones arrives at the top, because its id is made when it is imported. An entry brought back by raising N arrives at the top too, with a new id, and unread.
- A publish time that is wrong or in the future is shown as the source gives it and does not move the item. An item without a publish time shows no date.

## Interface

The user never sees a refresh. Items that a refresh imports appear at the top of the feed's list, and in `全部订阅`, the next time the list is loaded — by entering the scope, selecting a feed, switching the filter or reloading the page (`library.md` LIB-RELOAD-1) — with no progress, status or "last updated" line anywhere. A failed refresh shows no error and no status (FD-SCHED-5); writes it completed before failing (FD-SYNC-2) become visible on the next list load like any other.

## API

No endpoint refreshes a feed (`feeds.md`). Two things enqueue one: `POST /api/feeds`, which enqueues the new feed and answers 201 at once (FD-SCHED-7), and the server's scheduler, which lists every stored feed when it starts and at the configured refresh interval (FD-SCHED-1, FD-SCHED-6) and enqueues each. The scheduler's feed listing is its own query, not an endpoint.

## Messages

None. Nothing of this domain is shown to the user.

## Acceptance

```gherkin
Feature: Refreshing feeds
  To keep the stored articles in line with the sources
  As the server
  I want to fetch each feed, import its newest entries and drop the ones beyond retention

  Background:
    Given my account keeps 3 articles per feed

  Rule: A refresh imports the entries the feed does not have yet

    Scenario: New entries appear on top, unread
      Given a feed stores the items "c" and "b"
      And its source now lists "e", "d", "c", "b" in this order
      When the scheduler refreshes the feed
      Then the feed stores "e", "d", "c" with the newest on top
      And "e" and "d" are unread

    Scenario: Retention removes the oldest item
      Given a feed stores the items "d", "c" and "b"
      And its source lists "n", "d", "c" in this order
      When the scheduler refreshes the feed
      Then the feed stores "n", "d" and "c"
      And the item "b" is gone

    Scenario: A failing feed does not stop the others
      Given one feed's source cannot be fetched
      When the scheduler enqueues every feed
      Then the other feeds still import their new entries
      And the failed feed keeps its stored items and its old title
      And nothing about the failure is visible in the reader

    Scenario: A second request for a feed that is still refreshing is dropped
      Given a refresh of a feed is still running
      When the same feed is enqueued again
      Then the request is dropped
      And the source is fetched once for that refresh
```
