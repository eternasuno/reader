# Common

Rules shared by more than one domain. Each rule says where it lives. Entity-level rules (URL normalization, article values) are part of the entity schema and are never repeated in use cases.

Parsing and validation happen where outside data enters: HTTP input, adapter outputs (the fetchers, the feed parser, the article extractor, the sanitizer) and configuration. Past those boundaries, branded values are trusted and never re-validated. This holds for every domain and is not repeated in the other specs.

The dependency direction `SavedPage -> Feed -> Setting -> Common` constrains code imports, not specs: a spec may mention another domain to explain a rule.

## CM-URL — Normalized URL (entity schema)

`NormalizedUrl` is a branded `URL`, produced when a string is decoded at the boundary.

- CM-URL-1 Only the `http:` and `https:` protocols are accepted. Anything else fails decoding.
- CM-URL-2 Tracking parameters are removed, matched case-insensitively by name: every name that starts with `utm_`, and exactly `gclid`, `dclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `yclid`, `twclid`, `ttclid`, `li_fat_id`, `igshid`, `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`, `mkt_tok`, `_ga`, `_gl`. Generic names such as `ref`, `source`, `from` and `si` are kept, because sites also use them to select content.
- CM-URL-3 The fragment (`#...`) is always removed, whatever it contains.
- CM-URL-4 URLs that carry a user name or password are accepted and kept as given. They are stored and may be shown. A fetcher adapter must not reject a URL for carrying credentials.
- CM-URL-5 Use cases receive a `NormalizedUrl` and never normalize. The URL is used through its `href`, for example as the unique key of a feed or a saved page (CM-ID-6).
- CM-URL-6 The standard URL serialization applies (WHATWG `URL.href`): lower-case host, default port removed, empty path becomes `/`. Nothing else is normalized. So `https://site` and `https://site/` are the same URL; `https://site/post` and `https://site/post/` differ; `http` and `https`, `www` and no `www` differ.

Known limit of CM-URL-3: a site that routes by fragment (`https://site/#/post/1`) has all its pages collapse into one URL, so only one of them can be saved. This is accepted; anchors and text fragments in shared links are far more common than fragment routing.

## CM-ART — Article values (entity schema)

- CM-ART-1 `ArticleTitle`: trimmed; empty becomes "Untitled".
- CM-ART-2 `ArticleDescription` and `ArticleContent`: trimmed.
- CM-ART-3 An optional text that is absent or blank is `Option.none()`.
- CM-ART-4 A stored `ArticleDescription` or `ArticleContent` is always sanitized HTML. There are exactly two producers: the cleaning step of the feed refresh (CM-HTML) for feed text, and the `ArticleExtractor` port (CM-FETCH) for extracted pages. No use case stores text from any other source.
- CM-ART-5 "Empty content" means sanitized text that is blank after trimming, which is none (CM-ART-3). CM-FETCH-4 and CM-HTML-2 use this meaning.

## CM-ID — Ids

Every id (`FeedId`, `FeedItemId`, `SavedPageId`) is a branded string checked as a lower-case version-7 UUID (`Schema.isUUID(7)` and `Schema.isLowercased()`). The entity schema gives its `id` field a constructor default with `Model.UuidV7WithGenerate` (module `effect/schema`), so building a new row without an id makes one. There is no id port and no id helper. Duplicates are caught by URL, not by id (CM-ID-6, CM-PORT-6).

- CM-ID-1 Within one JS realm (one process without worker threads) every id is greater than every id made before it, comparing the lower-case string, which equals byte order.
- CM-ID-2 This holds when several ids are made in the same millisecond (a 42-bit counter orders them) and when the system clock stalls or goes back (the last timestamp is kept and the counter increases; on counter overflow the timestamp advances by 1 ms).
- CM-ID-3 Use cases build a new row with the entity schema's `makeEffect` inside their own fiber and leave `id` out; nothing else makes new ids, and none is made through the `SecureRandom` service's `uuidV7`, whose counter is separate. The default therefore takes its timestamp from the injected `Clock` and its random bits from `globalThis.crypto`. The input of a construction is already typed, so a construction failure is a defect (`Effect.orDie`), not a business error. It never changes the clock and nothing else in the system is affected. The default applies only when constructing: a row decoded from storage or from a request keeps its id, and decoding rejects anything but a lower-case version-7 UUID.
- CM-ID-4 The ordering state lives in the realm and is not persisted, and there is no ordering between processes or workers: after a restart with the system clock set back, new ids may be smaller than older ones. Accepted.
- CM-ID-5 Tests rely on the uniqueness and order of ids, never on exact id values or on a time read out of an id. Under a test clock that is behind the latest timestamp already used in the realm, a new id carries that latest timestamp instead of the test time. Effect marks `Model` unstable, so `effect/schema/Model` is listed in the type checker's `allowedUnstableApis`; if `UuidV7WithGenerate` changes, only the three `id` fields change.
- CM-ID-6 Uniqueness is by URL, enforced by the repository with a unique index in SurrealDB and covered by the contract suite: one feed per `(ownerId, url)`, one feed item per `(feedId, url)`, one saved page per `(ownerId, url)`. The same URL in two feeds is two items. A duplicate is reported as `FeedAlreadyExists(url)` or `SavedPageAlreadyExists(url)`; the error carries the normalized URL, so nothing is looked up when a concurrent create wins.
- CM-ID-7 `SavedPageRepository.findByUrl(owner, url)` returns an `Option`; adding a link and saving a feed item use it to refuse a duplicate before fetching (SP-ID-4). It is the only lookup by URL. Feeds have none: subscribing fetches nothing, so the unique key inside `create` is enough (FD-SUB-1), and the client finds the existing feed in its own list of feeds by the URL that `FeedAlreadyExists` carries.

## CM-FETCH — Fetch and extract an article from a URL

`fetchAndExtract(url)`. Used by SavedPage (add a link, save a feed item without content) and by Feed (extract an item).

1. Fetch the page text through `WebpageFetcher`, given `url.href`.
2. Parse it through `HtmlParser`, with `url` as the base. The parsed document lives in a resource scope opened by `fetchAndExtract`; see the port contracts below.
3. Extract through `ArticleExtractor`: title, description, content, and the publish time as an `Option`.
4. If the content is empty (CM-ART-5), fail `ArticleEmptyContent`.
5. Return title, description, the non-empty content, and the publish time as an `Option` (CM-FETCH-1): the extracted one, or none.

- CM-FETCH-1 The extractor reports a missing publish time as none, and nobody invents one: the use case returns it as none too. Every caller (SP-ADD, FD-EXTRACT) therefore gets none, and no extractor adapter carries a fallback.
- CM-FETCH-2 Which provider fetches the page (Jina or a browser service) depends on the owner's fetcher setting, and is decided outside business. The outer layer reads the setting and provides a `WebpageFetcher` built for it when it runs the use case. Business depends only on the port and takes no owner or provider parameter for fetching.
- CM-FETCH-3 The `ArticleExtractor` returns sanitized description and content (CM-ART-4). Sanitizing is part of the port's contract, not a separate step in the use case.
- CM-FETCH-4 Errors: `WebpageFetcherError`, `HtmlParserError`, `ArticleExtractorError`, `ArticleEmptyContent`. The operation stores nothing on failure.

## CM-HTML — Clean feed text before storing

A step of the feed refresh (`refreshFeed`, see `feed.md`), not a function of its own: it cleans the description and content of each imported entry. Input: the text and the item's URL as the base for relative links.

1. If `text` is absent, the result is none.
2. Parse it through `HtmlParser`, with `url` as the base.
3. Sanitize the document through `DocumentSanitizer`, which returns `Option<string>`.

- CM-HTML-2 Text that is empty after cleaning (CM-ART-5) is none.
- CM-HTML-3 Which tags, attributes and URLs survive sanitizing is decided by the sanitizer adapter, not by business.
- CM-HTML-4 Errors: `HtmlParserError`, `DocumentSanitizerError`.

## CM-PAGE — Paging a list

Used by the SavedPage and Feed item lists. Both lists are ordered by `id` descending, so the newest row is on top: ids are made in creation order (CM-ID-1). The list of feeds themselves is not paged this way; it is ordered by title, then `id` (FD-LIST-3).

- CM-PAGE-1 Order: `id` descending. A single-feed list is the all-feeds list restricted to one `feedId`: same order, same cursor shape.
- CM-PAGE-2 `limit` is a positive integer supplied by the caller. Business defines no page size. The boundary rejects zero, negative and non-integer values; there is no upper bound.
- CM-PAGE-3 A cursor is the `id` of a row. It carries no owner, scope or filter.
- CM-PAGE-4 Given an optional cursor, the list use case asks the repository for `limit + 1` rows strictly after the cursor (CM-PAGE-1), which are the rows with a smaller id. It returns the first `limit` rows. If more than `limit` rows came back, the result's cursor is the id of the last returned row; otherwise it is `null`.
- CM-PAGE-5 Business reads and returns the cursor as a structured value, the id of a row. How it is written into a request or response is decided at the boundary. A malformed cursor, including one that is not a lower-case version-7 UUID, is rejected there, so business has no cursor error.
- CM-PAGE-6 A cursor stays valid after its row is deleted, because it is an id, not a lookup key.
- CM-PAGE-7 Changing the scope or the filter starts a new list: the caller lists again with no cursor. Business does not check that a cursor belongs to the scope or filter it is used with. Using it elsewhere returns the rows after that position under the new selection, still limited to the caller's owner.
- CM-PAGE-8 `unreadOnly` is a plain boolean. `true` returns unread rows only; `false` returns all rows.
- CM-PAGE-9 To see current data the caller lists again from the first page. When to do so is the caller's decision.
- CM-PAGE-10 A row's id never changes while the row is stored, so paging never repeats or skips a row that stays stored. Rows deleted meanwhile simply do not appear. A row created meanwhile normally has a larger id and shows when the caller lists again from the first page. A row whose id was made before another row's id but written after it (syncs of different feeds running in parallel), or made after a restart with the clock set back (CM-ID-4), may sort below rows already seen: it shows on a later page if its id is below the cursor; if it falls among the rows already returned, it shows only when the caller lists again from the first page, and then not on top. A row removed and later created again gets a new id (an item imported again after retention removed it): it is a new arrival, on top and unread.

## CM-OWN — Ownership

- CM-OWN-1 The owner comes from the session at the boundary. The scheduler, which has no session, takes it from the stored feeds. Business never accepts an owner as client input.
- CM-OWN-2 Every repository method that reads or writes user data is scoped by `owner`.
- CM-OWN-3 Ids or rows that do not belong to the owner are treated as absent: reads return nothing, writes change nothing.

## CM-TIME — The current time

- CM-TIME-1 Wherever a rule says "now" (`Feed.updatedAt`), the use case reads the injected clock. No adapter and no entity reads the time for a business value. A publish time is not "now": a missing one stays none (CM-FETCH-1). The id default takes its timestamp from the injected `Clock` (CM-ID-3), but an id is not a time and business never reads a time out of an id.
- CM-TIME-2 Each use case function reads the injected clock at most once and uses that value throughout. A use case called by another reads its own clock. The time is never passed as a parameter. The id default reads the `Clock` once for each new row (CM-ID-3); that is not the use case's "now" and does not count here.

Readers of the clock: `refreshFeed` (`updatedAt`). `fetchAndExtract` and `subscribeFeed` read no clock.

## CM-PORT — Port contracts

An operation that only forwards one port call gets no use case. So part of the business behavior (skipping existing ids, owner scoping, unique URLs, removing a feed together with its items) is stated as port contracts in the domain specs.

- CM-PORT-1 A port contract is a business rule. Every implementation of a port, including a test double, must satisfy it.
- CM-PORT-2 Each repository port has one contract test suite, written against the port. It runs against every implementation.
- CM-PORT-3 Repository methods take generic patches (`update`, `updateAll`) rather than one method per intention. Which fields a caller may patch is limited at the boundary, not by the port.
- CM-PORT-4 A patch type is derived from the entity fields a caller may write. Immutable fields (`id`, `ownerId`, `feedId`, `url`, `publishedAt`) are never in a patch. In a patch, a missing field means no change and `Option.none` means clear.
- CM-PORT-5 `update(owner, ids, patch)` returns the ids among `ids` that exist for the owner, whether or not a value changed; each id appears at most once. An empty `ids` changes nothing and returns nothing.
- CM-PORT-6 `create(owner, rows)` returns the ids actually created. A row is skipped, never overwritten, when its id exists, when its unique URL key exists (CM-ID-6), when its `ownerId` differs from `owner`, and (for feed items) when its feed does not exist for the owner. Concurrent creates of the same URL key: exactly one succeeds.

## Functions

| Function          | Input           | Output                                                                               | Errors                                                                                   |
| ----------------- | --------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `fetchAndExtract` | `NormalizedUrl` | title, optional description, `ArticleContent`, publish time as `Option<DateTimeUtc>` | `WebpageFetcherError`, `HtmlParserError`, `ArticleExtractorError`, `ArticleEmptyContent` |

## Errors

| Error                    | Carries | Meaning                                   | Raised by                |
| ------------------------ | ------- | ----------------------------------------- | ------------------------ |
| `WebpageFetcherError`    | message | The page could not be fetched             | `WebpageFetcher` port    |
| `HtmlParserError`        | message | The text could not be parsed              | `HtmlParser` port        |
| `DocumentSanitizerError` | message | The document could not be sanitized       | `DocumentSanitizer` port |
| `ArticleExtractorError`  | message | The article could not be extracted        | `ArticleExtractor` port  |
| `ArticleEmptyContent`    | nothing | The extracted content is empty (CM-ART-5) | CM-FETCH step 4          |

## Port contracts

The shapes below are what business depends on. The adapter decodes its own output into these values; that is its boundary (CM-FETCH-3, CM-ART).

| Port                | Operation  | Input                   | Output                                                                                                          | Errors                   |
| ------------------- | ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `WebpageFetcher`    | `fetch`    | the URL text            | the page text                                                                                                   | `WebpageFetcherError`    |
| `HtmlParser`        | `parse`    | HTML text, the base URL | the parsed document, alive in the caller's resource scope (see below)                                           | `HtmlParserError`        |
| `DocumentSanitizer` | `sanitize` | the parsed document     | `Option<string>` of sanitized HTML                                                                              | `DocumentSanitizerError` |
| `ArticleExtractor`  | `extract`  | the parsed document     | `title: ArticleTitle`, optional `description`, optional sanitized `content`, `publishedAt: Option<DateTimeUtc>` | `ArticleExtractorError`  |

The parsed document lives in a resource scope opened by `fetchAndExtract` or by the cleaning step of the feed refresh. The scope covers the parse and the following extract or sanitize step, and is released when that step ends.

Redirects, timeouts, size limits and which addresses may be reached are the adapters' concern.

## Not common

- Choosing the extraction provider and the sanitizer's allowed markup are adapter concerns.
- Read-state rules (marking, idempotence) differ per domain and live in the SavedPage and Feed specs.
