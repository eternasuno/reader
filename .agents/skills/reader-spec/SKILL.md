---
name: reader-spec
description: What the Lantern personal reader does. Read before changing or verifying any product behavior — saved pages, feeds, folders, OPML, background refresh, the reader view, settings, Kindle delivery, authentication, or the library screen — or any HTTP endpoint, user-visible copy, or acceptance scenario.
---

# Reader Spec

Lantern is a single-user self-hosted read-later and RSS/Atom/RDF/JSON Feed reader with scheduled Send-to-Kindle delivery. The UI is bilingual (`zh-CN` Simplified Chinese and `en` English) via lightweight client-side dictionaries.

## Domain Index

Read this file plus the domain file(s) the change touches:

| File | Domain | Read when changing |
| --- | --- | --- |
| [auth.md](auth.md) | Single-password authentication & sessions | `/login`, session cookie, sign-out, auth middleware |
| [library.md](library.md) | Library shell, scopes, ID snapshots, read state, toasts | layout, sidebar, article list, unread filter, marking read, URL sync |
| [later.md](later.md) | Saved pages (`稍后阅读`), rules `SP-` | adding links, bookmarklet `/save`, saving feed items, removing pages |
| [feeds.md](feeds.md) | Feeds, items & OPML, rules `FD-` | preview, subscribe, unsubscribe, item lists, unread counts, extraction, OPML |
| [feeds-refresh.md](feeds-refresh.md) | Background refresh & parser (`FD-PARSE`, `FD-SEL`, `FD-SYNC`, `FD-SCHED`) | feed fetching, parsing, retention pruning, scheduler |
| [folders.md](folders.md) | Folders (`目录`), rules `FD-FOLDER`, `FD-MOVE` | creating, renaming, deleting folders, moving feeds, folder scope |
| [reader.md](reader.md) | Reader pane, rules `RD-` | content display, extracted view, embedded iframe, prev/next navigation |
| [settings.md](settings.md) | Settings, rules `SET-` | retention, Browserless fallback, OPML/bookmarklet UI, Kindle configuration |
| [kindle.md](kindle.md) | Send to Kindle, rules `KD-` | EPUB 3 generation, splitting, SMTP mailing, daily schedule |

## Routes

Every scope and open article has its own URL so reloads and browser history restore it:

| Path | Shows |
| --- | --- |
| `/` | redirects to `/all` (the library home; unknown paths and invalid `?next` fall back there too) |
| `/login` | password sign-in page (public) |
| `/save` | quick-save landing route for `#url=...` (and legacy `?url=...`; requires session, strips draft into memory, and redirects back after login) |
| `/later`, `/later/:pageId` | saved pages; with `:pageId`, that page open in the reader |
| `/all`, `/all/:itemId` | all feed items |
| `/feed/:feedId`, `/feed/:feedId/:itemId` | one feed's items |
| `/folder/:folderId`, `/folder/:folderId/:itemId` | items of feeds in one folder |
| `/settings` | settings page |

- The unread filter (`只显示未读`) is on by default and shared across all scopes; turning it off is encoded as query `?all` (present = show all, absent = unread only).
- Every route except `/login` requires a valid session. An unknown `feedId`, `folderId`, or article id in a URL renders the empty scope/reader rather than an error page.

## API & Client Conventions

- **JSON over `/api/*`**: all endpoints (except `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, `/healthz`) require a valid session cookie; missing/invalid session answers `401` with `{ "error": "Unauthorized" }`.
- **CSRF protection**: every state-changing `/api/*` request (`POST`, `PUT`, `PATCH`, `DELETE`) must carry an `Origin` (or `Referer`) matching `APP_URL`'s origin; missing or mismatched origin answers `403` with `{ "error": "Forbidden" }`.
- **Error format**: `{ "error": "<ErrorCode>" }` with semantic HTTP status (`400` validation/decode, `404` missing required target, `409` duplicate, `422` upstream/extraction/mail failure, `429` rate limit, `500` storage/internal failure). Backend emits codes only; client maps `<ErrorCode>` to the active locale (`zh-CN` / `en`) in one dictionary. Secrets never appear in responses or logs.
- **Optional fields & JSON `null`**: absent optional fields are omitted in JSON. The only explicit `null` values in JSON are `{ "item": null }` on missing single-item `GET` / lookup endpoints, and `{ "folderId": null }` when moving a feed to top level. Dates are RFC 3339 / ISO 8601 UTC strings.
- **Quick actions vs. forms**: quick actions (read toggles, mark above as read, mark-all, move feed, delete) are never disabled by client pending flags; optimistic updates roll back with an error toast on failure. Mark-all is the pessimistic exception: nothing changes until the server answers (`LIB-READ-2`). Forms (login, add link, preview/subscribe, folder create/rename, settings) keep native validation, disable while in flight, and show a pending label.

## Common Rules

### CM-URL — Normalized URL
- `CM-URL-1`: Only `http:` and `https:` URLs are accepted; others fail validation.
- `CM-URL-2`: Tracking query parameters are stripped case-insensitively: prefix `utm_`, and `gclid`, `dclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `yclid`, `twclid`, `ttclid`, `li_fat_id`, `igshid`, `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`, `mkt_tok`, `_ga`, `_gl`.
- `CM-URL-3`: Fragments (`#...`) are stripped.
- `CM-URL-4`: Canonicalized via standard URL serialization (lowercase host, default port removed, empty path becomes `/`). Trailing slashes on non-root paths, `http` vs `https`, and `www` vs apex are preserved as distinct unless normalized by standard URL rules.
- `CM-URL-5`: Embedded credentials (`user:pass@`) in feed or page URLs are accepted for private feeds/pages fetched by Go directly (sent as HTTP Basic auth), but are **stripped** from API responses, OPML exports, and logs, and are **never forwarded** to Browserless: a credentialed page URL is never retried through the Browserless fallback (`CM-FETCH-1`), so its direct failure is returned as is.

### CM-ID & CM-PAGE — Ordering & List Snapshots
- `CM-ID-1`: Feed, folder, feed item, and saved page IDs are monotonically increasing UUIDv7 strings generated on creation. `全部订阅` and folder snapshots group items by feed and sort groups in sidebar feed order, by `(title ASC, id ASC)` in UTF-8 byte order (`FD-LIST-1`). Within each group, the feed’s stored order sets the direction (`oldest` = `id ASC`, `newest` = `id DESC`). A single-feed snapshot has one group when nonempty and uses its `order` query when supplied or the feed’s stored order otherwise. Saved-page snapshots are flat and always use `id DESC`.
- `CM-PAGE-1`: Each list load fetches an ordered ID snapshot from its `/order` endpoint (`feeds.md`, `folders.md`, `later.md`). Feed-item snapshots return `{ boundary, groups: [{ feedId, ids }] }` and saved-page snapshots return `{ boundary, ids }`. Snapshot endpoints accept optional `unread` (boolean, default `false`) and optional `keep` (one UUIDv7, only when `unread` is true: a malformed, repeated, or empty `keep`, or `keep` with `unread` absent or false, is `400 RequestFailed`; a valid ID stays in the snapshot even if read, in its normal position, and contributes no row when it is missing, outside the scope, or above the boundary; the client sends the routed article as `keep` only when it is a valid UUIDv7 and refetches or discards a snapshot requested for a previously routed article), with optional `order` (`newest` or `oldest`) on the single-feed endpoint only. After validating the query and before any database read, including the feed’s stored-order lookup, the server mints a UUIDv7 boundary. Snapshots, unread counts, and read-all use `id <= boundary` as an ID-allocation cutoff. A row allocated before the boundary but committed after the snapshot read can be absent from the snapshot and still count in a later read. A server clock rollback can give a newly allocated ID at or below an existing boundary. A snapshot contains at most `10000` IDs. Overflow fails with `500 FeedItemRepositoryError` or `500 SavedPageRepositoryError` without returning partial results.
  - The client fetches article records in batches on demand for the current content window (`LIB-LIST-1`).
  - Batch `GET /api/feed-items` and `GET /api/saved-pages` accept only `ids`, one comma-separated value containing `1..200` distinct canonical UUIDv7 IDs. They return `{ items }` with unchanged item shapes, in request order, omitting missing IDs. Empty arrays in snapshot and batch responses serialize as `[]`.
  - Snapshot and batch endpoints reject malformed queries, unknown or repeated keys, and invalid values (including a blank `order` when supplied) with `400 RequestFailed`.
- `CM-PAGE-2`: `publishedAt` is display-only and never participates in sorting or snapshot queries.

### CM-ART & CM-HTML — Article Values & Sanitization
- `CM-ART-1`: `title` is trimmed; empty becomes `"Untitled"`. `description` and `content` are trimmed; blank becomes absent.
- `CM-ART-2`: Stored `description` and `content` (and `extractedContent`) are always sanitized HTML produced either at feed import or webpage extraction. Readers render stored HTML directly without re-sanitizing (`RD-BODY-1`).
- `CM-HTML-1`: HTML sanitization resolves relative `href`/`src` against the item/page URL, forces `target="_blank" rel="noopener noreferrer"` on links, and strips scripts, event handlers, forms, and unsafe tags/attributes.

### CM-FETCH — Webpage Fetching & Extraction
- `CM-FETCH-1`: Extraction flow: fetch page HTML directly with Go HTTP → parse & extract via Readability → sanitize (`CM-HTML-1`) → require non-empty `content` (`ArticleEmptyContent` otherwise). Missing `publishedAt` stays absent. When Browserless is configured (`SET-VAL-2`) and the direct attempt fails — a fetch error other than an SSRF block, or empty extracted content — the flow is retried once with the page HTML from Browserless (`POST {url}/unblock?timeout=..&token=..`, plus `&proxy=residential` when enabled). There is no retry for an SSRF-blocked target, a credentialed URL (`CM-URL-5`), or a cancelled request. If the retry fails, its error is returned (fetch failures are `WebpageFetcherError`). A fallback logs one info line with the host and reason, never the token or full URL. Time budgets: foreground extraction is capped at `55s` (server `WriteTimeout` `60s`); the direct step gets `15s` when Browserless is configured (otherwise `20s`); Browserless gets `min(45s, remaining − 3s)` and is skipped when that is under `8s`.
- `CM-FETCH-2`: Direct Go HTTP fetches (feeds, direct webpage extraction, EPUB images) enforce SSRF IP filtering (blocking loopback, private, link-local, and multicast ranges unless `ALLOW_PRIVATE_NETWORK=true`), re-validate target IPs on redirects, and enforce hard timeouts (`15s`–`30s`) + max response size (`10 MiB`). The configured Browserless URL itself may sit on a private/Docker address (it is not SSRF-filtered, and redirects from it are not followed so the token never leaves that host), while page navigation/subresource egress inside Browserless runs outside Go's dialer—firewall the Browserless service's egress separately if untrusted URLs are fetched through it.
- `CM-FETCH-3`: Nothing is saved if fetch, parse, extraction, or empty-content check fails.

### CM-PWA — Installable App
- `CM-PWA-1`: The SPA is an installable PWA named `Lantern` (`web/public/manifest.webmanifest`, standalone display, icons incl. maskable). `web/public/sw.js` (registered in production builds only, with a build-generated precache manifest and `lantern-<hash>` cache name covering the manifest and `sw.js` source injected by `web/vite.config.ts`) atomically precaches only public shell/assets (`/`, hashed `/assets/*`, icons, `manifest.webmanifest`) during `install` (`credentials: 'omit'`, `redirect: 'error'`, `response.ok && response.type === 'basic' && !response.redirected`), deleting any partial cache and failing the install on error, allows updates to wait until the previous worker has no clients, prunes obsolete `lantern-*` caches and claims clients on `activate`, serves only exact manifest pathnames without query strings cache-first from that build cache (bypassing query-string variants and non-manifest paths), and uses network-first with cached-shell fallback for navigation; it never intercepts `/api/*`, `/healthz`, non-GET, or cross-origin requests, so authenticated data is never cached. Offline navigation falls back to the cached shell, which then shows the normal network-error state.
- `CM-PWA-2`: Static files outside `/assets/` (including `sw.js` and `manifest.webmanifest`) are served `Cache-Control: no-cache`; `.webmanifest` is served as `application/manifest+json`.

## Shared Messages & Localization (`CM-I18N`)

- `CM-I18N-1`: Supported UI locales are `zh-CN` and `en`. Initial locale defaults from `navigator.language` (`zh*` → `zh-CN`, otherwise `en`) and persists in `localStorage` (`reader.locale`). Switching locale via `/login` or the sidebar menu updates UI copy and `document.documentElement.lang` reactively without reloading.
- `CM-I18N-2`: Domain `Messages` tables list the canonical `zh-CN` copy; `web/src/i18n/en.ts` provides a type-checked English translation for every key. Relative timestamps format via `Intl.RelativeTimeFormat` in the active locale (`<1 min` → `刚刚` / `just now`, `<60 min`, `<24 h`, `<=30 d`, otherwise localized short date).

| Code / Situation | Text (`zh-CN`) |
| --- | --- |
| `Unauthorized` | 登录状态已失效，请重新登录 |
| `Forbidden` | 不允许跨站修改 |
| `TooManyRequests` | 请求过于频繁，请稍后重试 |
| `RequestFailed` / fallback | 操作失败，请稍后重试 |
| `RequestTimeout` | 请求超时，请稍后重试 |
| `InvalidResponse` | 服务器返回了无法识别的响应 |
| `NetworkError` | 网络连接失败，请检查网络后重试 |
| `ArticleEmptyContent` | 未能提取到文章内容 |
| `WebpageFetcherError` | 网页抓取失败，请稍后重试 |
| `ArticleExtractorError` | 正文提取失败，请稍后重试 |
| checking session | skeleton shaped like the page being checked (library columns on guarded routes, the sign-in card on `/login`; no visible text); accessible name `正在确认登录状态…` |
