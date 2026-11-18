---
name: reader-engineering
description: How the 留白 target Go + SQLite + SolidJS 2 SPA reader is built. Read before writing or reviewing Go packages, HTTP handlers, background workers, webpage/feed fetchers, EPUB/SMTP adapters, frontend state, or tests. Database, UI styling, and Docker build details live in conditional files.
---

# Reader Engineering

Product behavior lives in `reader-spec`; this skill defines the target Go + SQLite + SolidJS 2 architecture and pinned libraries.

Conditional files:
- Read [database.md](database.md) when modifying SQLite connections, embedded migrations, indexes, or repositories.
- Read [ui.md](ui.md) when modifying styling, layout, shared UI controls, focus handling, or the article iframe.
- Read [deployment.md](deployment.md) when modifying `Dockerfile`, `go:embed` static serving, SPA fallback, or container build stages.

## Technology Choices

| Concern | Choice | Why |
| --- | --- | --- |
| Backend | Go `1.26+`, stdlib `net/http.ServeMux` | single static binary, low RAM (~20–50 MB), satisfies `modernc.org/sqlite@v1.62` & `gofeed@v1.5` floor |
| IDs | `github.com/google/uuid` (`uuid.NewV7`) | RFC 9562 UUIDv7 with built-in monotonic sequence counter |
| Database | SQLite via `modernc.org/sqlite` | pure Go (`CGO_ENABLED=0`), single file, no external DB process |
| Feed parsing | `github.com/mmcdole/gofeed` (`rss` / `atom` / `json` subparsers + `DetectFeedType`) | RSS/RDF, Atom, and JSON Feed in one library; format-specific parsers keep `FD-PARSE-*` exact |
| Readability | `codeberg.org/readeck/go-readability/v2` | Readability.js v0.6.0 compatible, faster & lower memory than archived `go-shiori/go-readability`, preserves Tailwind utility classes |
| HTML sanitizing | `golang.org/x/net/html` + `github.com/microcosm-cc/bluemonday` | relative `href`/`src` resolution, strict allowlist sanitization, link `target="_blank"` |
| Webpage fetch | Go `net/http` (default); optional Jina API or external CDP via `github.com/chromedp/chromedp` (`NewRemoteAllocator`) | zero-dependency fast path; heavy JS pages delegated only when an external endpoint is configured |
| Kindle EPUB & Mail | stdlib `archive/zip` (EPUB 3) + `github.com/wneessen/go-mail` | stored `mimetype` zip entry; context-aware SMTP with implicit TLS & STARTTLS |
| Frontend SPA | SolidJS 2 (`solid-js` `^2.0.0`, `@solidjs/web` `^2.0.0`), `@solidjs/router` `^2.0.0`, `@solid-primitives/i18n@next` (`^3.0.0-next.7`), `@tanstack/virtual-core` | async-in-graph reactivity, Solid 2 primitive i18n, thin custom wrapper over framework-agnostic `@tanstack/virtual-core` (avoids 1.x-only `@tanstack/solid-virtual` peer mismatch) |
| Styling & Build | Tailwind CSS 4 (`@tailwindcss/vite`), daisyUI 5, Vite 8/9 (`@solidjs/vite-plugin` `^3.0.0`), TypeScript, Biome, Vitest | native OXC Solid compiler (no Babel needed), zero runtime CSS-in-JS |

## Package Layout & Dependencies

```text
cmd/reader        ──> internal/http, internal/worker, internal/sqlite, internal/content, internal/fetcher, internal/epub, internal/mail, web (go:embed)
internal/http     ──> internal/domain, internal/worker
internal/worker   ──> internal/domain, internal/fetcher, internal/content, internal/epub, internal/mail
internal/sqlite   ──> internal/domain
internal/content  ──> internal/domain
internal/fetcher  ──> internal/domain
internal/epub     ──> internal/domain
internal/mail     ──> internal/domain
internal/domain   ──> Go stdlib + github.com/google/uuid only
```

- `internal/domain` defines entities, value objects (`NormalizedURL`, `Retention`, `FolderName`), pure selection/retention logic, and repository/adapter interfaces. It imports no DB, HTTP, or UI libraries.
- Adapters never import each other or `internal/http`.

## Backend Architecture & Security Rules

- **Auth & CSRF**:
  - `POST /api/auth/login` hashes both the submitted password and `APP_PASSWORD` with `crypto/sha256` before calling `crypto/subtle.ConstantTimeCompare` (preventing length timing leaks), protected by per-IP rate limiting. Sets an HMAC-SHA256 signed `HttpOnly` cookie (`SameSite=Lax`, `Secure` when `APP_URL` is `https://`).
  - All state-changing `/api/*` endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) verify `Origin` (falling back to `Referer` **only** when `Origin` is absent; rejecting missing, `"null"`, or malformed headers with `403`). Parse the header and `APP_URL` with `net/url` and require exact equality of lowercase `Scheme`, lowercase `Hostname()`, and effective port (`80`/`443` defaults normalized).
- **Dynamic external service config & job snapshots**: `internal/fetcher` reads the current `setting` row on each extraction, and `KindleSender` reads and **snapshots** the delivery + SMTP settings into the job when creating a `running` send — never cached at startup, and never mutated mid-delivery.
- **SSRF & Credential Boundaries**:
  - `internal/fetcher` wraps `net.Dialer.Control` so direct Go HTTP fetches (feeds, direct webpage extraction, EPUB images) resolve and reject loopback, private, link-local, and multicast IPs unless `ALLOW_PRIVATE_NETWORK=true`. Redirects re-run the dial-time check; hard timeouts (`15s`–`30s`) and body size caps (`10 MiB`) always apply.
  - External CDP (`BrowserEndpoint`, which itself may point to a private/Docker service) and Jina execute remote page/subresource fetches outside Go's dialer (`CM-FETCH-2`). Strip `user:pass@` URL credentials from API responses, OPML exports, and logs, and refuse (`422 WebpageFetcherError`) to forward credentialed URLs to `jina` or `browser` (`CM-URL-5`).
- **Secrets**: `JinaKey`, `BrowserEndpoint`, `SMTPPassword`, `APP_PASSWORD`, `SESSION_SECRET`, and URL credentials must never be returned in API responses or written to structured logs.
- **Workers**:
  - `RefreshQueue` deduplicates concurrent refreshes per `feedId` via an in-memory map + mutex, processes jobs through a bounded worker pool (default `5`), and updates `failure_count` / `last_error` in SQLite so repeated failures (`>= 3`) surface in the UI.
  - `KindleSender` acquires a per-process mutex/slot (`KindleSendInProgress` on conflict), persists the `running` `kindle_send` row with snapshotted delivery config, and **then** spawns the background worker using an application-owned `context.Context` (never `r.Context()`, which cancels when `202` is written). Startup marks any leftover `running` rows as `failed`.
- **HTTP Errors**: handlers decode/validate request bodies once, map domain errors to `{ "error": "<ErrorCode>" }`, and keep internal causes in server logs only.

## Frontend Architecture (`web/`)

- **Solid 2 conventions**: `tsconfig.json` sets `"jsx": "preserve"` and `"jsxImportSource": "@solidjs/web"`; imports use `@solidjs/web` (`render`, `Portal`, JSX types) and `solid-js` (`createSignal`, `createMemo`, `createEffect`, `createStore`, `snapshot`, `onSettled`); routing uses `@solidjs/router` 2.0 `createRouter({ routes })` config objects with plain `<a>` elements and `useNavigate()`.
- **URL as source of truth**: active scope, open article ID, and `?unread` filter derive from router matches. `SessionGuard` protects all routes except `/login`; `/save?url=...` renders a confirmation form (never mutating on `GET`) and preserves validated relative `?next` across login attempts.
- **State**: one Solid store/signal module per concept (`feed`, `folder`, `savedPage`, `libraryList`, `reader`, `toast`, `settings`), communicating via exported accessors/actions. Quick actions never disable on in-flight state and roll back optimistically on failure.
- **API client & i18n**: `web/src/i18n/` defines typed `zh-CN` and `en` dictionaries (`type Dict = typeof zhDict`) wrapped via `@solid-primitives/i18n` (`createMemo(() => i18n.flatten(dicts[locale()]))` + `i18n.translator(dict, i18n.resolveTemplate)`), persisted in `localStorage` (`reader.locale`, `CM-I18N-1`). `web/src/api/` maps `<ErrorCode>` through the translator; only non-login `401 Unauthorized` triggers global redirect to `/login` (`401 InvalidCredentials` stays on the login form).

## Testing

- **`internal/domain`**: Go `testing` unit tests for URL normalization/credential redaction, OPML parsing/atomicity, feed selection/retention table cases, and Kindle 20 MiB splitting.
- **`internal/sqlite`**: repository contract tests against temporary-file SQLite (`t.TempDir()`, never `:memory:` for WAL/multi-pool tests) verifying keyset paging, `ON DELETE SET NULL` folder deletion, startup migration, foreign keys across pooled connections, and `EXPLAIN QUERY PLAN`.
- **`internal/content` & `internal/fetcher`**: parser rules (`FD-PARSE-*`), `bluemonday` sanitization, `go-readability/v2` extraction fixtures, and SSRF dialer blocking private IPs / redirects.
- **`internal/http`**: `httptest` coverage for SHA-256 constant-time auth cookie, login rate limit, parsed `Origin`/`Referer` CSRF check, async `202` Kindle enqueue + `409` recovery, and secret redaction.
- **`web/`**: Vitest in a client/DOM posture (`environment: 'jsdom'` or `'happy-dom'`, since `@solidjs/vite-plugin` 3.0 emits SSR/server code under explicit `environment: 'node'`) for reactive Solid 2 stores/effects + manual browser checks for responsive 3-column layout, focus recovery, and sandboxed iframe sizing.
