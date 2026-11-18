---
name: reader-spec
description: What the 留白 reader does. Read before changing or verifying any product behavior — saved pages, feeds and feed items, folders, refresh and feed parsing, the reader view, settings, accounts, the library screen — or any HTTP endpoint, user-visible message or acceptance scenario. Holds the numbered business rules, the URL and API conventions and the shared rules; indexes one file per domain.
---

# Reader spec

留白 is a self-hosted read-later and feed reader. A user saves web pages to read later, subscribes to RSS, Atom, RDF and JSON feeds, groups feeds into folders, and reads everything in one place. Each account sees only its own data. The UI is Chinese only; there is no i18n layer.

## How to use this skill

1. Read this file, then the domain file of every domain the change touches (table below). Each domain file has the same sections, and each fact lives in exactly one of them: **Rules** (numbered), **Interface** (screens and interactions), **API** (endpoints), **Messages** (Chinese copy), **Acceptance** (Gherkin scenarios).
2. Change the spec in the same change as the behavior. Keep rule ids stable, give a new rule a new id, never reuse a removed id. A rule stated here is referred to by id from the domain files, not repeated.
3. Tests name the rule or scenario they cover (`SP-ADD-1`, `Scenario: Creating a folder`). How each layer is tested is in the `reader-engineering` skill.

| File | Domain | Read when the change touches |
| --- | --- | --- |
| [library.md](library.md) | The library screen: layout, sidebar scopes, the article list, unread filter, marking read, paging, toasts, mobile | the library screen as a whole, the list, the sidebar, read state shown across scopes |
| [later.md](later.md) | Saved pages (`稍后阅读`), rules `SP-` | adding a link, saving a feed item, saved-page list, read state, removal |
| [feeds.md](feeds.md) | Feeds and feed items, rules `FD-` | preview, subscribe, unsubscribe, feed and item lists, unread counts, extraction of an item |
| [feeds-refresh.md](feeds-refresh.md) | Refresh, scheduling, selection and retention, import, the feed parser contract (`FD-SEL`, `FD-SYNC`, `FD-PARSE`, …) | anything that runs during a refresh, the parser, retention |
| [folders.md](folders.md) | Folders (`目录`), rules `FD-FOLDER`, `FD-MOVE` | creating, renaming, deleting folders, moving feeds, the folder scope, choosing a folder when subscribing |
| [reader.md](reader.md) | The reader pane: default content, extracted content, embedded page, navigation | the reader view and its modes |
| [settings.md](settings.md) | Settings, rules `SET-` | retention, the page fetcher (Jina or a browser service), the Kindle delivery values, the settings page |
| [kindle.md](kindle.md) | Send to Kindle, rules `KD-` | mailing unread articles as an EPUB, the daily schedule, the send-now button |
| [account.md](account.md) | Accounts and sessions | registration, sign-in, sign-out, session guards, password change |

## Terms

- **Owner**: the signed-in user a row belongs to, taken from the session; the scheduler takes it from the stored feed.
- **Feed**: one owner's subscription to one source address. **Folder** (`目录`): a named group of one owner's feeds, one level deep; a feed is in at most one folder. **Source**: the remote RSS, Atom, RDF or JSON Feed document. **Entry**: one article as the source lists it. **Feed item** (UI: article, `文章`): a stored entry. **Saved page** (UI: `稍后阅读`): a page in the read-later list.
- **Scope**: what the article list shows: saved pages (`稍后阅读`), all feed items (`全部订阅`), one folder, or one feed.
- **Retention**: N, the number of items a feed keeps. **Sync**: bringing a feed's items in line with its source. **Refresh**: fetch plus sync; it always runs through the refresh queue.
- **Arrival order**: feed items and saved pages are listed by `id` descending; ids are made in creation order, so the newest is on top, and a stored row's id never changes.
- **Boundary**: where outside data becomes typed values: HTTP handlers, adapters (fetchers, feed parser, article extractor, sanitizer) and configuration. **Port**: an interface the business core depends on, implemented by an adapter and provided by injection.
- **Fetcher**: how a web page is fetched for extraction: the Jina reader API or a browser service the user runs.

## Routes

Every library scope and every open article has its own URL, so a reload or a shared link restores it.

| Path | Shows |
| --- | --- |
| `/` | redirects to `/later` |
| `/later`, `/later/:pageId` | saved pages; with an id, that page open in the reader |
| `/all`, `/all/:itemId` | all feed items |
| `/feed/:feedId`, `/feed/:feedId/:itemId` | one feed's items |
| `/folder/:folderId`, `/folder/:folderId/:itemId` | the items of the feeds in one folder |
| `/settings` | settings |
| `/login`, `/register` | sign-in and registration |

- The unread filter (`只显示未读`) is one filter shared by all scopes, carried as the query parameter `unread`: it is on when the parameter is present with any value or none (`?unread`), off when it is absent. The client writes `?unread` when turning it on and removes the parameter when turning it off; switching scope keeps it.
- Every route except `/login` and `/register` needs a session (`account.md`). An unknown feed, folder or article id in the URL shows the scope's empty state or the empty reader; it is not an error page.

## API conventions

The browser talks to the server over credentialed JSON HTTP under `/api`. Each domain file lists its endpoints; these conventions apply to all of them.

- Resources are addressed by path: `/api/<resource>` for a collection, `/api/<resource>/:id` for one row, `/api/<resource>/:id/<action>` or `/api/<resource>/<action>` for an operation that is not a plain read or write of the row. Ids in paths are lower-case UUIDv7 strings (CM-ID); a malformed id is a 400.
- `/api/auth/*` belongs to Better Auth (`account.md`). Every other endpoint needs a session: without one the answer is 401 with an empty body; when the session cannot be checked because the auth service fails, the answer is 500 `{ "_tag": "AuthUnavailable" }`. (A failure inside `/api/auth/*` itself is not a contract error: it answers 500 `{ "error": "Authentication unavailable" }` and the client shows the operation's fallback wording, `account.md`.) The `Origin` rule below is the application's; Better Auth applies its own origin checks to `/api/auth/*` (`account.md`). The owner is always the session's user (CM-OWN-1); a request naming another owner is still handled as the session's user.
- Every request that changes state (POST, PUT, PATCH, DELETE) is rejected with 403 and an empty body when it carries an `Origin` header that differs from the origin of the configured auth base URL. A request without `Origin` passes.
- Lists take the query `limit` (required positive integer, no maximum), `unread` (boolean, default `false`) and `cursor` (optional row id) and answer `{ items, cursor }`, where `cursor` is the id to pass for the next page or `null` (CM-PAGE). Non-paged lists answer `{ items }`.
- Reading one row answers `{ item }`, with `item: null` when the row does not exist for the owner. Creating answers 201 `{ item }`. A write with nothing to return answers 204 with no body.
- Optional fields are omitted from JSON when absent, never `null`. Dates are ISO 8601 strings. Every entity carries its `id`; secrets (the Jina key, the browser endpoint) never appear in a response, an error or a log.
- A request that fails structural decoding (malformed `limit`, `cursor` or id, missing field, wrong type) gets 400 with an empty body. A value that is well formed but breaks a domain value rule (an address that is not a valid `NormalizedUrl`, a blank folder name, a retention below 1, a browser endpoint with another protocol) gets 400 with the domain's tag (`InvalidPageUrl`, `FeedUrlInvalid`, `InvalidFolderName`, `InvalidRetention`, `InvalidEndpoint`), as each domain's API table lists. Every other failure carries `{ "_tag": "<ErrorName>" }`, plus `id` or `url` where the domain file says so, and no message: the wording is the web client's (Messages). Repository failures are 500 with their own tag, so the client can tell which data is unavailable.
- The client derives its requests and the set of error tags from one shared contract; no request is written by hand.

## Client conventions

The server is what keeps the data correct: it decodes and validates every request and answers a wrong one with an error (API conventions). Forms keep their validation for the user's benefit (each domain's Interface says which); quick actions stay simple.

- Quick actions — toggling read, `将已加载文章标为已读`, `全部标记为已读`, moving a feed, deleting — are always enabled. They do not depend on counts or on other requests in flight, and the client keeps no pending state to decide whether they may be pressed: it sends what it has, an empty id list or an id that no longer exists included, and the server ignores what does not apply (CM-PORT-5). An optimistic change still rolls back with an error toast when its request fails; when several requests for the same row overlap, the last answer wins.
- A form's submit, or an action that waits on a remote fetch (adding a link, preview, subscribe, extract, save to later), shows a loading spinner and is disabled while its request runs, so the request is not sent twice; it is enabled again when the request settles.

## Common rules

Rules shared by more than one domain. Parsing and validation happen where outside data enters: HTTP input, adapter outputs and configuration. Past those boundaries branded values are trusted and never re-validated. The dependency direction `SavedPage -> Feed -> Setting -> Common` constrains code imports, not the rules: a rule may mention another domain to explain itself.

### CM-URL — Normalized URL (entity schema)

`NormalizedUrl` is a branded `URL`, produced when a string is decoded at the boundary.

- CM-URL-1 Only the `http:` and `https:` protocols are accepted. Anything else fails decoding.
- CM-URL-2 Tracking parameters are removed, matched case-insensitively by name: every name that starts with `utm_`, and exactly `gclid`, `dclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `yclid`, `twclid`, `ttclid`, `li_fat_id`, `igshid`, `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`, `mkt_tok`, `_ga`, `_gl`. Generic names such as `ref`, `source`, `from` and `si` are kept, because sites also use them to select content.
- CM-URL-3 The fragment (`#...`) is always removed, whatever it contains.
- CM-URL-4 URLs that carry a user name or password are accepted and kept as given. They are stored and may be shown. A fetcher must not reject a URL for carrying credentials.
- CM-URL-5 Use cases receive a `NormalizedUrl` and never normalize. The URL is used through its `href`, for example as the unique key of a feed or a saved page (CM-ID-6).
- CM-URL-6 The standard URL serialization applies (WHATWG `URL.href`): lower-case host, default port removed, empty path becomes `/`. Nothing else is normalized. So `https://site` and `https://site/` are the same URL; `https://site/post` and `https://site/post/` differ; `http` and `https`, `www` and no `www` differ.

Known limit of CM-URL-3: a site that routes by fragment (`https://site/#/post/1`) has all its pages collapse into one URL, so only one of them can be saved. Accepted; anchors and text fragments in shared links are far more common than fragment routing.

### CM-ART — Article values (entity schema)

- CM-ART-1 `ArticleTitle`: trimmed; empty becomes "Untitled".
- CM-ART-2 `ArticleDescription` and `ArticleContent`: trimmed.
- CM-ART-3 An optional text that is absent or blank is none.
- CM-ART-4 A stored description or content is always sanitized HTML. There are exactly two producers: the cleaning step of the refresh (CM-HTML) for feed text, and the article extractor (CM-FETCH) for extracted pages. Nothing else stores article text.
- CM-ART-5 "Empty content" means sanitized text that is blank after trimming, which is none (CM-ART-3). CM-FETCH-4 and CM-HTML-2 use this meaning.

### CM-ID — Ids

Every id (`FeedId`, `FeedItemId`, `FolderId`, `SavedPageId`) is a branded string checked as a lower-case version-7 UUID (`Schema.isUUID(7)` and `Schema.isLowercased()`). The entity schema gives its `id` field the constructor default `Model.UuidV7WithGenerate` (`effect/schema`), so building a new row without an id makes one. There is no id port and no id helper. Duplicates are caught by URL or folder name, not by id.

- CM-ID-1 Within one JS realm every id is greater than every id made before it, comparing the lower-case string, which equals byte order.
- CM-ID-2 This holds when several ids are made in the same millisecond (a 42-bit counter orders them) and when the system clock stalls or goes back (the last timestamp is kept and the counter increases; on counter overflow the timestamp advances by 1 ms).
- CM-ID-3 Use cases build a new row with the entity schema's `makeEffect` inside their own fiber and leave `id` out; nothing else makes new ids, and none is made through `SecureRandom.uuidV7`, whose counter is separate. The default takes its timestamp from the injected `Clock` and its random bits from `globalThis.crypto`. The input of a construction is already typed, so a construction failure is a defect (`Effect.orDie`), not a business error. A row decoded from storage or from a request keeps its id, and decoding rejects anything but a lower-case version-7 UUID.
- CM-ID-4 The ordering state lives in the realm and is not persisted, and there is no ordering between processes or workers: after a restart with the system clock set back, new ids may be smaller than older ones. Accepted.
- CM-ID-5 Tests rely on the uniqueness and order of ids, never on exact id values or on a time read out of an id. Under a test clock behind the latest timestamp already used in the realm, a new id carries that latest timestamp instead of the test time.
- CM-ID-6 Uniqueness is by URL, or by name for folders, enforced by the repository with a unique constraint and covered by the contract suite: one feed per `(ownerId, url)`, one feed item per `(feedId, url)`, one saved page per `(ownerId, url)`, one folder per `(ownerId, name)` with the name compared exactly as stored, so case-sensitively. The same URL in two feeds is two items. A duplicate is reported as `FeedAlreadyExists(url)`, `SavedPageAlreadyExists(url)` or `FolderAlreadyExists(folderName)`; the business error carries the key, so nothing is looked up when a concurrent create wins. Over HTTP only `url` is carried (API conventions); `FolderAlreadyExists` carries nothing, because the client knows the name it sent.
- CM-ID-7 `SavedPageRepository.findByUrl(owner, url)` is the only lookup by URL; adding a link and saving a feed item use it to refuse a duplicate before fetching (SP-ID-4). Feeds have none: subscribing fetches nothing, so the unique key inside `create` is enough (FD-SUB-1), and the client finds the existing feed in its own feed list by the URL that `FeedAlreadyExists` carries.

### CM-FETCH — Fetch and extract an article from a URL

`fetchAndExtract(url)`, used by adding a link, saving a feed item without content, and extracting a feed item.

1. Fetch the page text through `WebpageFetcher`, given `url.href`.
2. Parse it through `HtmlParser`, with `url` as the base. The parsed document lives in a resource scope opened by `fetchAndExtract` that covers the parse and the extract step.
3. Extract through `ArticleExtractor`: title, description, content, and the publish time as an option.
4. If the content is empty (CM-ART-5), fail `ArticleEmptyContent`.
5. Return title, description, the non-empty content, and the publish time.

- CM-FETCH-1 The extractor reports a missing publish time as none, and nobody invents one.
- CM-FETCH-2 Which provider fetches the page depends on the owner's fetcher setting. Business decides which one is in effect (`activeFetcher`, SET-ACTIVE); the server provides a `WebpageFetcher` for the owner that reads the setting when the page is fetched (not before the use case runs), maps the result to the provider's `WebpageFetcher` by exhaustive match with no condition of its own, and delegates the fetch. Business takes no owner or provider parameter for fetching.
- CM-FETCH-3 The extractor returns sanitized description and content (CM-ART-4). Sanitizing is part of the port's contract, not a step of the use case. Redirects, timeouts, size limits and which addresses may be reached are the fetcher's concern.
- CM-FETCH-4 Errors: `WebpageFetcherError`, `SettingRepositoryError`, `HtmlParserError`, `ArticleExtractorError`, `ArticleEmptyContent`. Over HTTP every endpoint that extracts answers `SettingRepositoryError` with status 500, and the other four with status 422 and the tags `WebpageFetcherError`, `ArticleExtractorError` (also for `HtmlParserError`, which has no contract tag) and `ArticleEmptyContent`; domain API tables list only the contract tags. Nothing is stored on failure.

### CM-HTML — Clean feed text before storing

A step of the refresh (`feeds-refresh.md`): it cleans the description and content of each imported entry, with the item's URL as the base for relative links.

1. If the text is absent, the result is none.
2. Parse it through `HtmlParser`, with the URL as the base.
3. Sanitize the document through `DocumentSanitizer`, which returns an optional string.

- CM-HTML-2 Text that is empty after cleaning (CM-ART-5) is none.
- CM-HTML-3 Which tags, attributes and URLs survive sanitizing is decided by the sanitizer adapter: DOMPurify defaults, relative `href` and `src` resolved against the base, `target="_blank"` on links so they leave the sandboxed reader frame.
- CM-HTML-4 Errors: `HtmlParserError`, `DocumentSanitizerError`.

### CM-PAGE — Paging a list

Used by the saved-page list and the three feed-item lists, ordered by `id` descending except a single-feed list whose feed stores the order `oldest` (CM-PAGE-1). Feeds and folders are not paged.

- CM-PAGE-1 Order: `id` descending. A single-feed list whose feed stores the order `oldest` lists by `id` ascending instead, and its cursor then means larger ids (FD-PREF-3); otherwise a single-feed or single-folder list is the all-items list restricted to that scope: same order, same cursor shape.
- CM-PAGE-2 `limit` is a positive integer supplied by the caller. Business defines no page size and no upper bound; the boundary rejects zero, negative and non-integer values.
- CM-PAGE-3 A cursor is the `id` of a row. It carries no owner, scope or filter.
- CM-PAGE-4 Given an optional cursor, the list use case asks the repository for `limit + 1` rows strictly after the cursor in the list's order, so of smaller ids under `newest` and of larger ids under `oldest` (CM-PAGE-1, FD-PREF-3). It returns the first `limit` rows; if more than `limit` came back, the result's cursor is the id of the last returned row, otherwise `null`.
- CM-PAGE-5 A malformed cursor, including one that is not a lower-case version-7 UUID, is rejected at the boundary, so business has no cursor error.
- CM-PAGE-6 A cursor stays valid after its row is deleted, because it is a position, not a lookup key.
- CM-PAGE-7 Changing the scope, the filter or the order starts a new list: the caller lists again with no cursor. Business does not check that a cursor belongs to the scope, the filter or the order it is used with.
- CM-PAGE-8 `unread` is a plain boolean. `true` returns unread rows only; `false` returns all rows.
- CM-PAGE-9 To see current data the caller lists again from the first page. When to do so is the caller's decision; there is no background reload and no refresh-through request.
- CM-PAGE-10 A row's id never changes while the row is stored, so paging never repeats or skips a row that stays stored. Rows deleted meanwhile do not appear. A row created meanwhile normally has a larger id and shows when the caller lists again from the first page. A row whose id was made before another row's id but written after it (syncs of different feeds in parallel), or made after a restart with the clock set back (CM-ID-4), may sort below rows already seen: it shows on a later page if its id is below the cursor, otherwise only when the caller lists again, and then not on top. A row removed and created again gets a new id: it is a new arrival, on top and unread.

### CM-OWN — Ownership

- CM-OWN-1 The owner comes from the session at the boundary. The scheduler, which has no session, takes it from the stored feeds. Nothing accepts an owner as client input.
- CM-OWN-2 Every repository method that reads or writes user data is scoped by owner.
- CM-OWN-3 Ids or rows that do not belong to the owner are treated as absent: reads return nothing, writes change nothing.

### CM-TIME — The current time

- CM-TIME-1 Wherever a rule says "now" (`Feed.updatedAt`), the use case reads the injected clock. No adapter and no entity reads the time for a business value. A publish time is not "now": a missing one stays none. An id is not a time and business never reads a time out of an id.
- CM-TIME-2 Each use case reads the injected clock at most once and uses that value throughout; a use case called by another reads its own clock; the time is never passed as a parameter. The id default reads the clock once per new row (CM-ID-3); that does not count here. The only reader of "now" is the refresh (`updatedAt`).

### CM-PORT — Port contracts

An operation that only forwards one port call gets no use case, so part of the behavior (skipping existing ids, owner scoping, unique URLs and folder names, a feed's folder belonging to its owner, cascading removal) is stated as port contracts. The contracts are JSDoc on the port interfaces in `packages/business/src/port/` and carry these rule ids.

- CM-PORT-1 A port contract is a business rule. Every implementation of a port, including a test double, must satisfy it.
- CM-PORT-2 Each repository port has one contract test suite, written against the port and run against every implementation.
- CM-PORT-3 Repository write methods are named by what they do and take the values they write as parameters (`markRead(owner, ids, read)`, `moveToFolder(owner, id, folderId)`, `rename(owner, id, name)`, `setRetention(owner, retention)`). There is no generic patch: no method takes an object of optional fields, and no implementation branches on which fields were given; each write method is one fixed statement in the adapter, and bulk `create` repeats the same per-row statement for every row inside one transaction. Immutable fields (`id`, `ownerId`, `feedId`, `url`, `publishedAt`) have no write method.
- CM-PORT-5 The single-row writes the use cases must tell apart (`FeedRepository.moveToFolder`, `FolderRepository.rename`, `FeedItemRepository.setExtractedContent`) return whether the row was written: `false` when the row does not exist for the owner and, for the two guarded writes, when the guard fails; guard and write are one atomic statement. `FeedRepository.recordSync` returns nothing. Writes over an id list or a scope return nothing; unknown and foreign ids are ignored and an empty list changes nothing.
- CM-PORT-6 `create(owner, rows)` returns the ids actually created. A row is skipped, never overwritten, when its id exists, when its unique key exists (CM-ID-6), when its `ownerId` differs from `owner`, (for feed items) when its feed does not exist for the owner, and (for feeds) when its `folderId` names a folder that does not exist for the owner. Concurrent creates of one key: exactly one succeeds.

CM-PORT-4 is retired.

## Decisions behind the rules

The reasons for choices that the rules alone do not explain.

- Saving a feed item copies it (SP-SAVE): retention and unsubscribing remove feed items, and a page the user chose to keep must survive both.
- Duplicates are decided inside `create` by unique keys (CM-ID-6, CM-PORT-6), not by a lookup before writing: concurrent requests then cannot both win, and no application lock is needed.
- URL credentials are kept (CM-URL-4): private feeds and pages behind HTTP basic auth must keep working.
- Only two producers store article HTML (CM-ART-4), so the reader can show stored HTML without cleaning it again.
- Each feed-item scope has its own endpoint and use case (FD-LIST-1), so no layer branches on a scope value.
- Retention follows the source's order and ignores read state (`feeds-refresh.md`): what a feed keeps should match what the source shows, not depend on how the user reads.
- Subscribing only enqueues a refresh: the request answers at once, and refresh has one code path with one guarantee of at most one run per feed.
- An unknown feed is never an error (FD-OWN-2): feeds disappear concurrently (unsubscribed in another window, removed with a folder), and an operation on a feed that is gone has nothing left to do.
- The browser endpoint can only be replaced (SET-ENDPOINT-1): clearing it could leave the browser provider selected with no endpoint, which SET-FETCH-4 forbids.
- No limits are added (text length, request size, batch or page size, timeout, concurrency) until running the application shows one is needed; a limit guessed in advance breaks real feeds and pages without evidence that it protects anything.

## Shared messages

Copy used by every domain. Each error tag's wording is written once: here when several domains raise it, otherwise in the Messages of the domain that owns the error (`FeedItemNotFound` in feeds.md, `FolderNotFound` in folders.md, `SettingRepositoryError` in settings.md, `SavedPageAlreadyExists` in later.md, and so on). A domain whose endpoints return another domain's error lists the tag in its API table only. The web client keeps one table from error tag to wording, built from these sections.

| Tag or situation | Text |
| --- | --- |
| `Unauthorized` | 登录状态已失效，请重新登录 |
| `Forbidden` | 不允许跨站修改 |
| `AuthUnavailable` | 登录服务暂时不可用，请稍后重试 |
| `RequestFailed` (unexpected status) | 请求失败，请稍后重试 |
| `NetworkError` (no response) | 网络连接失败，请检查网络后重试 |
| `InvalidResponse` (response does not decode) | 响应数据格式不正确，请稍后重试 |
| `ArticleEmptyContent` (CM-FETCH-4) | 未能提取到文章内容 |
| `WebpageFetcherError` (CM-FETCH-4) | 网页抓取失败，请稍后重试 |
| `ArticleExtractorError` (CM-FETCH-4; also a page that cannot be parsed) | 正文提取失败，请稍后重试 |
| any other failure | 操作失败，请稍后重试 |
| checking the session | 正在确认登录状态… |
| session check failed | 暂时无法确认登录状态，请刷新重试。 |

Dates in lists are relative: under a minute `刚刚`, then `N分前`, `N小时前`, `N天前` up to 30 days, after that the `zh-CN` date.

Done when the changed behavior matches this skill, the skill describes the new behavior, and the tests that name the affected rules and scenarios pass.
