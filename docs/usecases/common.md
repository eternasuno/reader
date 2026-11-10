# Common

Rules shared by more than one domain. Each rule says where it lives. Entity-level rules (URL normalization, article values) are part of the entity schema and are never repeated in use cases.

Parsing and validation happen only at the boundary. Past it, branded values are trusted and never re-validated. This holds for every domain and is not repeated in the other specs.

## CM-URL — Normalized URL (entity schema)

`NormalizedUrl` is a branded `URL`, produced when a string is decoded at the boundary.

- CM-URL-1 Only the `http:` and `https:` protocols are accepted. Anything else fails decoding.
- CM-URL-2 These query parameters are removed, matched case-insensitively by name: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id`, `gclid`, `dclid`, `fbclid`, `msclkid`.
- CM-URL-3 The fragment (`#...`) is always removed, whatever it contains.
- CM-URL-4 URLs that carry a user name or password are accepted and kept as given. They are stored and may be shown.
- CM-URL-5 Use cases receive a `NormalizedUrl` and never normalize. Identity hashes (CM-ID) use its `href`.
- CM-URL-6 Nothing else is normalized. `http` and `https`, `www` and no `www`, and a trailing slash or none are different URLs.

Known limit of CM-URL-3: a site that routes by fragment (`https://site/#/post/1`) has all its pages collapse into one URL, so only one of them can be saved. This is accepted; anchors and text fragments in shared links are far more common than fragment routing.

## CM-ART — Article values (entity schema)

- CM-ART-1 `ArticleTitle`: trimmed; empty becomes "Untitled".
- CM-ART-2 `ArticleDescription` and `ArticleContent`: trimmed.
- CM-ART-3 An optional text that is absent or blank is `Option.none()`.
- CM-ART-4 A stored `ArticleDescription` or `ArticleContent` is always sanitized HTML. There are exactly two producers: `cleanHtml` (CM-HTML) for feed text, and the `ArticleExtractor` port (CM-FETCH) for extracted pages. No use case stores text from any other source.

## CM-ID — Id helper

`hashId(parts)`: a helper that turns an ordered list of text parts into an id. Each domain decides which parts make up the id of its own entities (see FD-ID and SP-ID).

- CM-ID-1 It is deterministic: the same parts in the same order always give the same id.
- CM-ID-2 The id is the SHA-256, written as hex, of the JSON encoding of the array of parts. The JSON encoding keeps part boundaries, so `["ab", "c"]` and `["a", "bc"]` give different ids.
- CM-ID-3 It adds no entity-type prefix. Two entities of different types built from the same parts get the same id. They live in different collections, so this is harmless.
- CM-ID-4 Because ids are deterministic, "already exists" is decided by id. `create` skipping an existing id is what makes concurrent duplicate requests safe.
- CM-ID-5 A part that is absent is passed as an empty string.

## CM-FETCH — Fetch and extract an article from a URL

`fetchAndExtract(url)`. Used by SavedPage (add a link, save a feed item without content) and by Feed (extract an item).

1. Fetch the page text through `WebpageFetcher`, given `url.href`.
2. Parse it through `HtmlParser`, with `url` as the base. The parsed document lives only for the duration of the call.
3. Extract through `ArticleExtractor`: title, description, content, and the publish time as an `Option`.
4. If the content is empty, fail `ArticleEmptyContent`.
5. Return title, description, non-empty content, and the publish time: the extracted one, or the current time when the page has none.

- CM-FETCH-1 The extractor reports a missing publish time as none. It never invents one. The fallback to the current time is in this use case, so every caller (SP-ADD, FD-EXTRACT) shares it and every extractor adapter is free of it.
- CM-FETCH-2 Which provider fetches the page (Jina or a browser service) depends on the owner's fetcher setting, and is decided outside business. The outer layer reads the setting and provides a `WebpageFetcher` built for it when it runs the use case. Business depends only on the port and takes no owner or provider parameter for fetching.
- CM-FETCH-3 The `ArticleExtractor` returns sanitized description and content (CM-ART-4). Sanitizing is part of the port's contract, not a separate step in the use case.
- CM-FETCH-4 Errors: `WebpageFetcherError`, `HtmlParserError`, `ArticleExtractorError`, `ArticleEmptyContent`. The operation stores nothing on failure.

## CM-HTML — Clean feed text before storing

`cleanHtml(text, url?, maxLength)`. Used when importing feed items for their description and content.

1. If `text` is absent, the result is none.
2. Cut `text` to `maxLength` characters.
3. Parse it through `HtmlParser`, with `url` as the base.
4. Sanitize the document through `DocumentSanitizer`, which returns `Option<string>`.

- CM-HTML-1 `maxLength` is a parameter. Business defines no number; the Feed domain reads it from `FeedImportConfig` (see `feed.md`), which is provided from outside.
- CM-HTML-2 Text that is empty after cleaning is none.
- CM-HTML-3 Which tags, attributes and URLs survive sanitizing is decided by the sanitizer adapter, not by business.
- CM-HTML-4 Errors: `HtmlParserError`, `DocumentSanitizerError`.

## CM-PAGE — Paging a list

Used by the SavedPage and Feed lists. The domains differ in how they select rows (owner, feed scope, `unreadOnly`) and in which time they sort by: feed items by `publishedAt`, saved pages by `savedAt`. Below, "sort time" means that field.

- CM-PAGE-1 Order: sort time descending, then `id` descending.
- CM-PAGE-2 `limit` is a parameter supplied by the caller. Business defines no page size. The boundary bounds it.
- CM-PAGE-3 A cursor is a position: the sort time and the `id` of a row. It carries no owner, scope or filter.
- CM-PAGE-4 Given an optional cursor, the helper asks the repository for `limit + 1` rows strictly after the cursor. It returns the first `limit` rows. If more than `limit` rows came back, the result's cursor is the position of the last returned row; otherwise it is `null`.
- CM-PAGE-5 Business reads and returns the cursor as a structured value. How it is written into a request or response is decided at the boundary, which must keep the full precision of the sort time. A malformed cursor is rejected there, so business has no cursor error.
- CM-PAGE-6 A cursor stays valid after its row is deleted, because it is a position, not a lookup key.
- CM-PAGE-7 Changing the scope or the filter starts a new list: the caller lists again with no cursor. Business does not check that a cursor belongs to the scope or filter it is used with. Using it elsewhere returns the rows after that position under the new selection, still limited to the caller's owner.
- CM-PAGE-8 `unreadOnly` is a plain boolean. `true` returns unread rows only; `false` returns all rows.
- CM-PAGE-9 To see current data the caller lists again from the first page. When to do so is the caller's decision.

## CM-OWN — Ownership

- CM-OWN-1 The owner comes from the session at the boundary. The scheduler, which has no session, takes it from the stored feeds. Business never accepts an owner as client input.
- CM-OWN-2 Every repository method that reads or writes user data is scoped by `owner`.
- CM-OWN-3 Ids or rows that do not belong to the owner are treated as absent: reads return nothing, writes change nothing.

## CM-TIME — The current time

- CM-TIME-1 Wherever a rule says "now" (`savedAt`, `updatedAt`, a missing publish time), the use case reads the injected clock. No adapter and no entity reads the time itself.
- CM-TIME-2 One use case run reads the clock once and uses that value throughout, so rows written together carry the same time.

## CM-PORT — Port contracts

Operations that need one port call have no use case, so part of the business behavior (skipping existing ids, owner scoping, removing a feed together with its items) is stated as port contracts in the domain specs.

- CM-PORT-1 A port contract is a business rule. Every implementation of a repository port, including a test double, must satisfy it.
- CM-PORT-2 Each repository port has one contract test suite, written against the port. It runs against every implementation.
- CM-PORT-3 Repository methods take generic patches (`update`, `updateAll`) rather than one method per intention. Which fields a caller may patch is limited at the boundary, not by the port.

## Not common

- Choosing the extraction provider and the sanitizer's allowed markup are adapter concerns.
- Read-state rules (marking, idempotence) differ per domain and live in the SavedPage and Feed specs.
