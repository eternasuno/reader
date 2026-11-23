---
name: reader-spec
description: What the 留白 personal reader does. Read before changing or verifying any product behavior — saved pages, feeds, folders, OPML, background refresh, the reader view, settings, Kindle delivery, authentication, or the library screen — or any HTTP endpoint, user-visible copy, or acceptance scenario.
---

# Reader Spec

留白 is a single-user self-hosted read-later and RSS/Atom/RDF/JSON Feed reader with scheduled Send-to-Kindle delivery. The UI is bilingual (`zh-CN` Simplified Chinese and `en` English) via lightweight client-side dictionaries.

## Domain Index

Read this file plus the domain file(s) the change touches:

| File | Domain | Read when changing |
| --- | --- | --- |
| [auth.md](auth.md) | Single-password authentication & sessions | `/login`, session cookie, sign-out, auth middleware |
| [library.md](library.md) | Library shell, scopes, paging, read state, toasts | layout, sidebar, article list, unread filter, marking read, URL sync |
| [later.md](later.md) | Saved pages (`稍后阅读`), rules `SP-` | adding links, bookmarklet `/save`, saving feed items, removing pages |
| [feeds.md](feeds.md) | Feeds, items & OPML, rules `FD-` | preview, subscribe, unsubscribe, item lists, unread counts, extraction, OPML |
| [feeds-refresh.md](feeds-refresh.md) | Background refresh & parser (`FD-PARSE`, `FD-SEL`, `FD-SYNC`, `FD-SCHED`) | feed fetching, parsing, retention pruning, scheduler |
| [folders.md](folders.md) | Folders (`目录`), rules `FD-FOLDER`, `FD-MOVE` | creating, renaming, deleting folders, moving feeds, folder scope |
| [reader.md](reader.md) | Reader pane, rules `RD-` | content display, extracted view, embedded iframe, prev/next navigation |
| [settings.md](settings.md) | Settings, rules `SET-` | retention, fetcher choice, OPML/bookmarklet UI, Kindle configuration |
| [kindle.md](kindle.md) | Send to Kindle, rules `KD-` | EPUB 3 generation, splitting, SMTP mailing, daily schedule |

## Routes

Every scope and open article has its own URL so reloads and browser history restore it:

| Path | Shows |
| --- | --- |
| `/` | redirects to `/later` |
| `/login` | password sign-in page (public) |
| `/save` | quick-save landing route for `?url=...` (requires session; redirects back after login) |
| `/later`, `/later/:pageId` | saved pages; with `:pageId`, that page open in the reader |
| `/all`, `/all/:itemId` | all feed items |
| `/feed/:feedId`, `/feed/:feedId/:itemId` | one feed's items |
| `/folder/:folderId`, `/folder/:folderId/:itemId` | items of feeds in one folder |
| `/settings` | settings page |

- The unread filter (`只显示未读`) is shared across all scopes via query `?unread` (present = on, absent = off).
- Every route except `/login` requires a valid session. An unknown `feedId`, `folderId`, or article id in a URL renders the empty scope/reader rather than an error page.

## API & Client Conventions

- **JSON over `/api/*`**: all endpoints (except `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, `/healthz`) require a valid session cookie; missing/invalid session answers `401` with `{ "error": "Unauthorized" }`.
- **CSRF protection**: every state-changing `/api/*` request (`POST`, `PUT`, `PATCH`, `DELETE`) must carry an `Origin` (or `Referer`) matching `APP_URL`'s origin; missing or mismatched origin answers `403` with `{ "error": "Forbidden" }`.
- **Error format**: `{ "error": "<ErrorCode>" }` with semantic HTTP status (`400` validation/decode, `404` missing required target, `409` duplicate, `422` upstream/extraction/mail failure, `429` rate limit, `500` storage/internal failure). Backend emits codes only; client maps `<ErrorCode>` to the active locale (`zh-CN` / `en`) in one dictionary. Secrets never appear in responses or logs.
- **Optional fields & JSON `null`**: absent optional fields are omitted in JSON. The only explicit `null` values in JSON are `cursor: null` on the last page, `{ "item": null }` on missing single-item `GET` / lookup endpoints, and `{ "folderId": null }` when moving a feed to top level. Dates are RFC 3339 / ISO 8601 UTC strings.
- **Quick actions vs. forms**: quick actions (read toggles, mark-loaded, mark-all, move feed, delete) are never disabled by client pending flags; optimistic updates roll back with an error toast on failure. Forms (login, add link, preview/subscribe, folder create/rename, settings) keep native validation, disable while in flight, and show a pending label.

## Common Rules

### CM-URL — Normalized URL
- `CM-URL-1`: Only `http:` and `https:` URLs are accepted; others fail validation.
- `CM-URL-2`: Tracking query parameters are stripped case-insensitively: prefix `utm_`, and `gclid`, `dclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `yclid`, `twclid`, `ttclid`, `li_fat_id`, `igshid`, `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`, `mkt_tok`, `_ga`, `_gl`.
- `CM-URL-3`: Fragments (`#...`) are stripped.
- `CM-URL-4`: Canonicalized via standard URL serialization (lowercase host, default port removed, empty path becomes `/`). Trailing slashes on non-root paths, `http` vs `https`, and `www` vs apex are preserved as distinct unless normalized by standard URL rules.
- `CM-URL-5`: Embedded credentials (`user:pass@`) in feed or page URLs are accepted for private feeds/pages fetched by Go directly (sent as HTTP Basic auth), but are **stripped** from API responses, OPML exports, and logs, and are **never forwarded** to third-party extractors (`jina` or external `browser` CDP; attempting to extract a credentialed URL via an external provider fails `422 WebpageFetcherError`).

### CM-ID & CM-PAGE — Ordering & Keyset Paging
- `CM-ID-1`: Feed, folder, feed item, and saved page IDs are monotonically increasing UUIDv7 strings generated on creation. Arrival order is `id DESC` (newest on top); `order=oldest` on any item or saved page list uses `id ASC`.
- `CM-PAGE-1`: Paged list endpoints accept `limit` (integer `1..200`, default `30`), `unread` (boolean, default `false`), `order` (`newest` default | `oldest`; invalid values fail `400 RequestFailed`; single-feed lists fall back to the feed's stored order when absent), and optional `cursor` (valid UUIDv7 row id; continues in the chosen order). Response is `{ items, cursor }` where `cursor` is the last returned row's id if more rows exist, else `null`.
- `CM-PAGE-2`: `publishedAt` is display-only and never participates in sorting or cursor queries.

### CM-ART & CM-HTML — Article Values & Sanitization
- `CM-ART-1`: `title` is trimmed; empty becomes `"Untitled"`. `description` and `content` are trimmed; blank becomes absent.
- `CM-ART-2`: Stored `description` and `content` (and `extractedContent`) are always sanitized HTML produced either at feed import or webpage extraction. Readers render stored HTML inside a sandboxed iframe without re-sanitizing.
- `CM-HTML-1`: HTML sanitization resolves relative `href`/`src` against the item/page URL, forces `target="_blank" rel="noopener noreferrer"` on links, and strips scripts, event handlers, forms, and unsafe tags/attributes.

### CM-FETCH — Webpage Fetching & Extraction
- `CM-FETCH-1`: Extraction flow: fetch page HTML via the active fetcher (`direct` HTTP by default, or `jina` / external `browser` CDP if configured in Settings) → parse & extract via Readability → sanitize (`CM-HTML-1`) → require non-empty `content` (`ArticleEmptyContent` otherwise). Missing `publishedAt` stays absent.
- `CM-FETCH-2`: Direct Go HTTP fetches (feeds, direct webpage extraction, EPUB images) enforce SSRF IP filtering (blocking loopback, private, link-local, and multicast ranges unless `ALLOW_PRIVATE_NETWORK=true`), re-validate target IPs on redirects, and enforce hard timeouts (`15s`–`30s`) + max response size (`10 MiB`). The configured external `BrowserEndpoint` itself may sit on a private/Docker address, while page navigation/subresource egress inside external `browser` (CDP) or `jina` runs outside Go's dialer—firewall the remote browser container's egress separately if untrusted URLs are fetched through it.
- `CM-FETCH-3`: Nothing is saved if fetch, parse, extraction, or empty-content check fails.

## Shared Messages & Localization (`CM-I18N`)

- `CM-I18N-1`: Supported UI locales are `zh-CN` and `en`. Initial locale defaults from `navigator.language` (`zh*` → `zh-CN`, otherwise `en`) and persists in `localStorage` (`reader.locale`). Switching locale via `/login` or the sidebar menu updates UI copy and `document.documentElement.lang` reactively without reloading.
- `CM-I18N-2`: Domain `Messages` tables list the canonical `zh-CN` copy; `web/src/i18n/en.ts` provides a type-checked English translation for every key. Relative timestamps format via `Intl.RelativeTimeFormat` in the active locale (`<1 min` → `刚刚` / `just now`, `<60 min`, `<24 h`, `<=30 d`, otherwise localized short date).

| Code / Situation | Text (`zh-CN`) |
| --- | --- |
| `Unauthorized` | 登录状态已失效，请重新登录 |
| `Forbidden` | 不允许跨站修改 |
| `TooManyRequests` | 请求过于频繁，请稍后重试 |
| `RequestFailed` / fallback | 操作失败，请稍后重试 |
| `NetworkError` | 网络连接失败，请检查网络后重试 |
| `ArticleEmptyContent` | 未能提取到文章内容 |
| `WebpageFetcherError` | 网页抓取失败，请稍后重试 |
| `ArticleExtractorError` | 正文提取失败，请稍后重试 |
| checking session | 正在确认登录状态… |
