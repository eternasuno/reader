# 留白

> **Target Architecture Notice**: This README and `.agents/skills/` define the **target Go + SQLite + SolidJS 2 single-binary architecture** for the upcoming rewrite. Until that migration lands, the repository tree still holds the previous Node/TypeScript workspace (`apps/reader`, `packages/*`).

留白 is a lightweight, single-user self-hosted RSS reader and read-later app with scheduled Send-to-Kindle support.

- **Read later**: save web URLs (or browser bookmarklet quick-save) with automatic article extraction and clean reading typography.
- **RSS / Atom / RDF / JSON Feed**: organize feeds into single-level folders, import/export OPML, read with per-feed sort order and default display mode, and auto-prune to the latest N articles per feed.
- **Send to Kindle**: bundle unread articles into EPUB 3 (auto-split at 20 MiB) and mail via SMTP on a daily schedule or on demand.
- **Single-container, low footprint**: compiled into one static Go binary with the SPA embedded via `go:embed` and SQLite storage (~25–40 MB Docker image, ~20–50 MB RAM).

## Target Architecture Overview

- **Backend**: Go `1.27+` (`net/http`, `modernc.org/sqlite`, `github.com/mmcdole/gofeed`, `codeberg.org/readeck/go-readability/v2`, `github.com/microcosm-cc/bluemonday`, `archive/zip` EPUB 3 builder, `github.com/wneessen/go-mail`).
- **Frontend**: SolidJS 2 SPA (`web/`: `solid-js` `^2.0.0`, `@solidjs/web` `^2.0.0`, `@solidjs/router` `^2.0.0`, `@solid-primitives/i18n@next` for bilingual `zh-CN` / `en`, `@tanstack/virtual-core`, Tailwind CSS 4, daisyUI 5, built with Vite 8/9 + `@solidjs/vite-plugin` `^3.0.0`) embedded into the Go binary via `go:embed`.
- **Storage**: single SQLite file (`<DATA_DIR>/reader.db`) with WAL mode and embedded startup migrations.

## Requirements (Local Build)

- Go `>= 1.27`
- Node `>= 24` (Active LTS) and `pnpm` (to build the frontend assets under `web/`)

## Target Docker Deployment

```sh
docker volume create reader-data

docker run -d --name reader --restart unless-stopped \
  -p 8080:8080 \
  -e APP_PASSWORD="change-me-to-a-strong-password" \
  -e APP_URL="http://localhost:8080" \
  -e TZ="Asia/Shanghai" \
  -v reader-data:/data \
  reader:latest
```

Build the image locally:

```sh
docker build -t reader:latest .
```

Notes:
- **Migrations**: SQLite schema migrations are embedded in the binary and applied idempotently on startup before serving traffic. During early development, delete `reader.db` and restart whenever the schema changes. Do not run concurrent replicas against the same SQLite file.
- **Volume permissions**: the distroless container runs as non-root UID `65532`. Always mount the `/data` directory (never a single file mount, so SQLite can create `-wal`/`-shm` files) and ensure bind-mounted host directories are writable by UID `65532`.
- **Reverse proxy**: terminate HTTPS in front of the container, set `APP_URL` to the public `https://` origin, and forward `Origin` / `Host` headers.
- **Health check**: `GET /healthz` returns `200 OK` when the server and SQLite database are healthy.
- **External extractors (optional)**: Jina API Key and external CDP `ws://` / `http://` endpoints are configured in the web UI. When running a headless browser in another container on the same Docker network, `localhost` refers to the reader container itself, and outbound egress from that browser container should be firewalled if you fetch untrusted pages (Go's SSRF IP filter only governs direct Go HTTP fetches).

## Environment Variables

Only bootstrap/infrastructure options use environment variables. **External service settings and keys (Jina API Key, external CDP browser endpoint, Kindle email & SMTP credentials) are all configured dynamically in the `/settings` web UI and persisted in SQLite**, taking effect immediately without restarting the container. Background feed refresh interval is fixed at `30 minutes`.

| Variable | Default | Required | Purpose |
| --- | --- | --- | --- |
| `APP_PASSWORD` | — | Yes | Login password for the single user |
| `APP_URL` | `http://localhost:8080` | Yes (prod) | Canonical public origin for cookie `Secure` flag and CSRF `Origin` checks |
| `PORT` | `8080` | No | HTTP listen port |
| `DATA_DIR` | `/data` (Docker) / `.data` (local) | No | Directory storing `reader.db` |
| `SESSION_SECRET` | random per startup | No | Fixed 32+ byte secret so login cookies survive container restarts |
| `TZ` | system zone | No | Time zone for daily Kindle schedule and EPUB date titles |
| `ALLOW_PRIVATE_NETWORK` | `false` | No | Set `true` only if you intentionally subscribe to local/LAN feeds (e.g. local RSSHub); otherwise Go's outbound HTTP fetcher blocks private/loopback IPs against SSRF |

## Local Development

```sh
# 1. Build web/dist once so go:embed compiles, then start Vite dev server (e.g. :5173)
pnpm --dir web install
pnpm --dir web build
pnpm --dir web dev

# 2. Start Go server with APP_URL matching Vite's dev origin so CSRF Origin checks pass
APP_PASSWORD=dev-password APP_URL=http://localhost:5173 DATA_DIR=.data go run ./cmd/reader
```

Production binary build:

```sh
pnpm --dir web build
CGO_ENABLED=0 go build -o reader ./cmd/reader
APP_PASSWORD=secret DATA_DIR=.data ./reader
```

## Quick-Save Bookmarklet

In **设置 → 文章与订阅**, copy the generated bookmarklet to your browser bookmarks bar (or open `<APP_URL>/save?url=<encoded_url>`) to prefill and save the current page to 稍后阅读.
