---
name: reader-deployment
description: Conditional file of reader-engineering. Read when modifying Dockerfile, go:embed asset serving, SPA fallback, or /healthz.
---

# Deployment Engineering

Operator setup, the `docker-compose.yml` example, and environment variables live in [README.md](../../../README.md) (human-facing; no compose file is committed and nothing is built locally); this file records build, runtime, and release mechanics for agents.

## Multi-Stage Build & Embedding

- **Base images are unpinned**: stages use floating tags without `@sha256` digests so rebuilds pick up upstream security patches; if an upstream update breaks the build, fix it manually.
- **Stage 1 (`node:26-alpine`)**: Node 25+ images no longer bundle corepack, so pnpm is installed with `npm install -g pnpm@<version>`; builds `web/` (`pnpm install --frozen-lockfile && pnpm build`) into `web/dist/`.
- **Stage 2 (`golang:1.27-alpine`)**: copies Go source + `web/dist/`, prepares an empty `/empty-data` directory (`mkdir -m 0700 -p /empty-data && chown 65532:65532 /empty-data`), and compiles `CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/reader ./cmd/reader`.
- **Stage 3 (`gcr.io/distroless/static-debian12:nonroot`)**: copies `/out/reader` and `COPY --from=go-build --chown=65532:65532 --chmod=0700 /empty-data /data` (explicit numeric UID/GID ownership and `0700` mode since distroless has no shell). `cmd/reader` imports `_ "time/tzdata"` so user-selected IANA time zones (Kindle schedule) resolve without OS zoneinfo files; there is no `TZ` environment variable.
- **Container smoke check**: verify DB creation and a WAL write inside the built container running as UID `65532` with `/data` mounted as a directory.

## Runtime & Release

- **Release**: pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which builds `linux/amd64` + `linux/arm64` and pushes `ghcr.io/<owner>/reader` tagged `X.Y.Z`, plus `latest` for non-prerelease versions (metadata-action default `latest=auto`). The README example uses `:latest`.
- **Single instance**: startup holds an exclusive advisory lock on `<DATA_DIR>/lantern.lock`; a second process exits with `another Lantern instance is already using DATA_DIR`, so a failed rebind during manual tests leaves the old binary serving.
- **Data**: `/data` must be a directory or named volume (SQLite needs `-wal`/`-shm`), writable by UID `65532`.
- **Shutdown & restarts**: shutdown is hard-capped at `3s` (`shutdownTimeout`); Docker's default 10s `stop_grace_period` is only the SIGKILL backstop, so the compose example omits it (some deploy panels accept only an integer there). A persistent database failure exits non-zero and `restart: unless-stopped` restarts the container; `docker stop` never restarts it (`reader-engineering` Fail fast rule).
- **Schema**: Lantern is deployed; schema changes add a new goose Go migration in `internal/sqlite/migrations/` (see [database.md](database.md)) tracked in `goose_db_version`, never edit applied migrations, and preserve existing data.

## Static Serving & Routing (`internal/http`)

- Embed `web/dist/` with `//go:embed all:dist` in `web/embed.go`. Because `go:embed` fails to compile if `web/dist/` is missing, local development requires running `pnpm --dir web build` once before `go run ./cmd/reader` (or providing a `//go:build dev` fallback).
- Route dispatch order:
  1. `GET /healthz` — verifies SQLite `SELECT 1`; returns `200 ok` or `503`.
  2. `/api/*` — API handlers (unmatched `/api/*` returns `404` JSON, never SPA HTML).
  3. Embedded static assets — serve hashed assets (`/assets/*`) with long-lived `Cache-Control: public, max-age=31536000, immutable`; serve `index.html` with `Cache-Control: no-cache` for SPA fallback on extensionless `GET`/`HEAD` routes.
- In local development (`devenv.nix` + `secretspec.toml` with the `dotenv` provider), Vite serves `web/` on `http://localhost:5173` and proxies `/api/*` to the Go server on `PORT` (`8080`), with `APP_URL` set to `http://localhost:5173`. Because `:8080` also serves the embedded `web/dist/` SPA, opening `:8080` or `127.0.0.1:5173` in the browser sends a mismatched `Origin` and fails CSRF (`403 Forbidden`); always open the exact `APP_URL` origin (`http://localhost:5173`).
