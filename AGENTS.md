# Project Guide

Lantern is a single-user self-hosted RSS reader, read-later app, and Kindle EPUB mailer built as a single Go binary with an embedded SolidJS 2 SPA (`web/`) and SQLite.

## Repository Layout

- `cmd/reader/` — application entrypoint: config, SQLite startup migration, background workers, HTTP server.
- `internal/domain/` — core entities, value normalization/validation, selection/retention logic, and repository/adapter interfaces.
- `internal/sqlite/` — SQLite connection (`modernc.org/sqlite`), embedded SQL migrations, and repository implementations.
- `internal/content/` — feed parsing (`gofeed`), Readability extraction (`codeberg.org/readeck/go-readability/v2`), HTML sanitization (`bluemonday`).
- `internal/fetcher/` — SSRF-safe HTTP client, optional Jina client, optional external CDP client (`chromedp.NewRemoteAllocator`).
- `internal/epub/` — EPUB 3 builder (`archive/zip`) with bounded-concurrency image embedding and 20 MiB splitting.
- `internal/mail/` — SMTP mail sender (`github.com/wneessen/go-mail`).
- `internal/http/` — HTTP handlers (`net/http.ServeMux`), password auth + HMAC session cookie, CSRF Origin/Referer check, OPML import/export, `/healthz`.
- `internal/worker/` — feed refresh queue/scheduler and Kindle async sender/scheduler.
- `web/` — SolidJS 2 (`solid-js` `^2.0.0` + `@solidjs/web` `^2.0.0` + `@solidjs/router` `^2.0.0` + `@solid-primitives/i18n@next` + `@tanstack/virtual-core`) + Tailwind CSS 4 + daisyUI 5 SPA compiled by Vite 8/9 (`@solidjs/vite-plugin` `^3.0.0`) to `web/dist/` and embedded via `go:embed`.

## Project Skills

Read the relevant skill before making changes:

- [`reader-spec`](.agents/skills/reader-spec/SKILL.md) — product behavior: numbered rules, routes, UI behavior, API endpoints, Chinese copy, and key acceptance scenarios.
- [`reader-engineering`](.agents/skills/reader-engineering/SKILL.md) — engineering architecture: Go packages, dependency direction, error/security rules, testing; database, UI, and Docker build details live in conditional files indexed there.

## Workflow & Engineering Guardrails

- **Spec & code in sync**: update the matching `reader-spec` file in the same change when product behavior changes.
- **Security**: never log or return secrets (`APP_PASSWORD`, `SESSION_SECRET`, Jina key, browser endpoint, SMTP password, or URL `user:pass@` credentials). Keep Go SSRF IP filtering enabled unless `ALLOW_PRIVATE_NETWORK=true`. Enforce parsed `Origin` (or fallback `Referer` origin when `Origin` is absent) matching `APP_URL` on every state-changing `/api/*` endpoint.
- **UI decisions**: no thumbnails, no per-list summary-line setting (summary is fixed at 3 lines), no keyboard-shortcuts item in the user menu, no end-of-article next card, no manual refresh menu item, no "open in new page" list option; `+` beside `订阅源` opens the add-feed dialog directly and folders are created only from `移动到`. Details live in `reader-spec`.
- **Resource bounds**: every outbound HTTP/CDP request, feed parse, image download, list `limit`, and refresh worker pool must have explicit bounds/timeouts.
- **Verification**: run `go test ./...`, `go vet ./...`, `go tool golangci-lint run ./...`, and frontend typecheck/lint/test/build under `web/` (`pnpm --dir web check`, `pnpm --dir web test`, `pnpm --dir web build`), and verify UI changes in a browser when touching layout or iframe rendering.
