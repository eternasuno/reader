---
name: reader-deployment
description: Conditional file of reader-engineering. Read when modifying Dockerfile, go:embed asset serving, SPA fallback, or /healthz.
---

# Deployment Engineering

Operator setup, commands, environment variables, and `docker run` examples live in [README.md](../../../README.md); this file records build and runtime mechanics only.

## Multi-Stage Build & Embedding

- **Stage 1 (`node:26-alpine`)**: uses Node 26 LTS (`corepack enable`) and builds `web/` (`pnpm install --frozen-lockfile && pnpm build`) into `web/dist/`.
- **Stage 2 (`golang:1.26-alpine`)**: copies Go source + `web/dist/`, prepares an empty `/empty-data` directory (`mkdir /empty-data && chown 65532:65532 /empty-data`), and compiles `CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/reader ./cmd/reader`.
- **Stage 3 (`gcr.io/distroless/static-debian12:nonroot`)**: copies `/out/reader` and `COPY --from=build --chown=65532:65532 /empty-data /data` (explicit numeric UID/GID ownership since distroless has no shell). `cmd/reader` imports `_ "time/tzdata"` so `TZ` works without OS zoneinfo files.
- **Container smoke check**: verify DB creation and a WAL write inside the built container running as UID `65532` with `/data` mounted as a directory.

## Static Serving & Routing (`internal/http`)

- Embed `web/dist/` with `//go:embed all:dist` in `web/embed.go`. Because `go:embed` fails to compile if `web/dist/` is missing, local development requires running `pnpm --dir web build` once before `go run ./cmd/reader` (or providing a `//go:build dev` fallback).
- Route dispatch order:
  1. `GET /healthz` — verifies SQLite `SELECT 1`; returns `200 ok` or `503`.
  2. `/api/*` — API handlers (unmatched `/api/*` returns `404` JSON, never SPA HTML).
  3. Embedded static assets — serve hashed assets (`/assets/*`) with long-lived `Cache-Control: public, max-age=31536000, immutable`; serve `index.html` with `Cache-Control: no-cache` for SPA fallback on extensionless `GET`/`HEAD` routes.
- In local development, Vite serves `web/` (e.g. `http://localhost:5173`) and proxies `/api/*` to the Go server on `PORT`; set `APP_URL` to Vite's origin so CSRF `Origin` checks pass.
