# Common

Rules shared by more than one domain. Each rule says where it lives. Entity-level rules (URL normalization, article values) are part of the entity schema and are never repeated in use cases.

Parsing and validation happen only at the boundary. Past it, branded values are trusted and never re-validated.

## CM-URL — Normalized URL (entity schema)

`NormalizedUrl` is a branded `URL`, produced when a string is decoded at the boundary.

- CM-URL-1 Only the `http:` and `https:` protocols are accepted. Anything else fails decoding.
- CM-URL-2 These query parameters are removed, matched case-insensitively by name: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id`, `gclid`, `dclid`, `fbclid`, `msclkid`.
- CM-URL-3 The fragment (`#...`) is removed.
- CM-URL-4 URLs that carry a user name or password are accepted and kept as given. They are stored and may be shown.
- CM-URL-5 Use cases receive a `NormalizedUrl` and never normalize. Identity hashes (CM-ID) use its `href`.

## CM-ART — Article values (entity schema)

- CM-ART-1 `ArticleTitle`: trimmed; empty becomes "Untitled".
- CM-ART-2 `ArticleDescription` and `ArticleContent`: trimmed.
- CM-ART-3 An optional text that is absent or blank is `Option.none()`.

## CM-ID — Id helper

`hashId(parts)`: a helper that turns an ordered list of text parts into an id. Each domain decides which parts make up the id of its own entities (see FD-ID and SP-ID).

- CM-ID-1 It is deterministic: the same parts in the same order always give the same id.
- CM-ID-2 It is collision-resistant. The hash is SHA-256, written as hex, over the ordered parts.
- CM-ID-3 It adds no entity-type prefix. Two entities of different types built from the same parts get the same id. They live in different collections, so this is harmless.
- CM-ID-4 Because ids are deterministic, "already exists" is decided by id. `create` skipping an existing id is what makes concurrent duplicate requests safe.
- CM-ID-5 A part that is absent is passed as an empty string.

## CM-FETCH — Fetch and extract an article from a URL

`fetchAndExtract(url)`. Used by SavedPage (add a link, save a feed item without content) and by Feed (extract an item).

1. Fetch the page text through `WebpageFetcher`, given `url.href`.
2. Parse it through `HtmlParser`, with `url` as the base. The parsed document lives only for the duration of the call.
3. Extract through `ArticleExtractor`: title, description, content, publish time.
4. If the content is empty, fail `ArticleEmptyContent`.
5. Return title, description, non-empty content and publish time.

- CM-FETCH-1 When the page has no publish time, the extractor returns the current time.
- CM-FETCH-2 Which provider fetches the page (Jina or a browser service) is decided outside business. Business only depends on the `WebpageFetcher` port.
- CM-FETCH-3 Errors: `WebpageFetcherError`, `HtmlParserError`, `ArticleExtractorError`, `ArticleEmptyContent`. The operation stores nothing on failure.

## CM-HTML — Clean feed text before storing

`cleanHtml(text, url?, maxLength)`. Used when importing feed items for their description and content.

1. If `text` is absent, the result is none.
2. Cut `text` to `maxLength` characters.
3. Parse it through `HtmlParser`, with `url` as the base.
4. Sanitize the document through `DocumentSanitizer`, which returns `Option<string>`.

- CM-HTML-1 `maxLength` is a parameter supplied by the caller. Business defines no number.
- CM-HTML-2 Text that is empty after cleaning is none.
- CM-HTML-3 Which tags, attributes and URLs survive sanitizing is decided by the sanitizer adapter, not by business.
- CM-HTML-4 Errors: `HtmlParserError`, `DocumentSanitizerError`.

## CM-PAGE — Paging a list

Used by SavedPage and Feed lists. The domains differ only in how they select rows (owner, feed scope, `unreadOnly`).

- CM-PAGE-1 Order: `publishedAt` descending, then `id` descending.
- CM-PAGE-2 `limit` is a parameter supplied by the caller. Business defines no page size.
- CM-PAGE-3 A cursor is a position: `{ publishedAt, id }`. It carries no owner, scope or filter.
- CM-PAGE-4 Given an optional cursor, the helper asks the repository for `limit + 1` rows strictly after the cursor. It returns the first `limit` rows. If more than `limit` rows came back, the result's cursor is the position of the last returned row; otherwise it is `null`.
- CM-PAGE-5 Business reads and returns the cursor as a structured value. How it is written into a request or response (encoded string, separate parameters) is decided at the boundary. A malformed cursor is rejected there, so business has no `InvalidCursor`.
- CM-PAGE-6 A cursor stays valid after its row is deleted, because it is a position, not a lookup key.
- CM-PAGE-7 Changing the scope or the filter starts a new list: the caller lists again with no cursor. Business does not check that a cursor belongs to the scope or filter it is used with. Using it elsewhere returns the rows after that position under the new selection, still limited to the caller's owner.
- CM-PAGE-8 `unreadOnly` is a plain boolean. `true` returns unread rows only; `false` returns all rows. There is no separate read-filter type and no read-only view.
- CM-PAGE-9 There is no refresh-through operation. To see current data the caller lists again from the first page.

## CM-OWN — Ownership

- CM-OWN-1 The owner comes from the session at the boundary. Business never accepts an owner as client input.
- CM-OWN-2 Every repository method that reads or writes user data is scoped by `owner`.
- CM-OWN-3 Ids or rows that do not belong to the owner are treated as absent: reads return nothing, writes change nothing.

## Not common

- Choosing the extraction provider and the sanitizer's allowed markup are adapter concerns.
- Read-state rules (marking, idempotence) differ per domain and live in the SavedPage and Feed specs.
