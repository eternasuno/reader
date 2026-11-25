# Lantern

A lightweight, single-user, self-hosted RSS reader and read-later app with Send-to-Kindle.

- **Read later**: save a URL (or use the bookmarklet) and read a cleaned-up version of the article.
- **Feeds**: RSS / Atom / RDF / JSON Feed, single-level folders, OPML import/export, per-feed sort order and default view, automatic pruning to the latest N articles per feed.
- **Send to Kindle**: bundle unread articles into EPUB 3 (split at 20 MiB) and mail them over SMTP daily or on demand.
- **Installable PWA**: the app shell works offline; API data is never cached.
- **One container**: a single static Go binary with the web app embedded and SQLite storage.

## Quick start

Images are published to GitHub Container Registry for every release (`ghcr.io/eternasuno/reader`, tagged with the version and `latest`; `linux/amd64` and `linux/arm64`). Save this as `docker-compose.yml` and run `APP_PASSWORD='a-strong-password' docker compose up -d`:

```yaml
services:
  reader:
    image: ghcr.io/eternasuno/reader:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      APP_PASSWORD: ${APP_PASSWORD:?set APP_PASSWORD}
      APP_URL: http://localhost:8080
      TZ: Asia/Shanghai
      # SESSION_SECRET: <32+ random bytes>  # keeps logins valid across restarts
    volumes:
      - reader-data:/data

volumes:
  reader-data:
```

Open <http://localhost:8080> and sign in with `APP_PASSWORD`. Behind a reverse proxy, terminate HTTPS there, set `APP_URL` to the public `https://` origin, and forward the `Origin` and `Host` headers.

## Configuration

Only bootstrap options are environment variables. Jina key, external browser endpoint, and Kindle / SMTP settings are configured in the web UI (**Settings**) and take effect immediately.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_PASSWORD` | required | Login password |
| `APP_URL` | `http://localhost:8080` | Public origin; used for the cookie `Secure` flag and CSRF `Origin` checks |
| `PORT` | `8080` | HTTP listen port |
| `DATA_DIR` | `/data` in Docker, `.data` locally | Directory holding `reader.db` |
| `SESSION_SECRET` | random per start | 32+ bytes; set it so logins survive restarts |
| `TZ` | system zone | Time zone for the Kindle schedule and EPUB titles |
| `ALLOW_PRIVATE_NETWORK` | `false` | Allow subscribing to LAN / loopback feeds (otherwise blocked as SSRF protection) |

## Operations

- **Data**: mount `/data` as a directory or named volume (never a single file) and keep one instance per database. The container runs as UID `65532`; bind mounts must be writable by it.
- **Health check**: `GET /healthz` returns `200` when the server and database are healthy.
- **Shutdown and restarts**: shutdown is capped at 3 seconds and unfinished work is abandoned. If the database keeps failing, the process exits non-zero and `restart: unless-stopped` brings it back; `docker stop` never restarts it.
- **External browser / Jina (optional)**: inside Docker, `localhost` is the reader container itself. Firewall the browser container's egress if you fetch untrusted pages, because the SSRF filter only covers the reader's own HTTP fetches.

## Development

```sh
pnpm --dir web install
pnpm --dir web build   # go:embed needs web/dist
devenv up              # Go API on :8080 + Vite on :5173 (log in with dev-password)
```

Without devenv, run `pnpm --dir web dev` and `APP_PASSWORD=dev-password APP_URL=http://localhost:5173 DATA_DIR=.data go run ./cmd/reader`.

Development variables live in `secretspec.toml` (values in the gitignored `.env`). Inside the devenv shell, `check` runs vet, golangci-lint and the web typecheck/lint; `tests` runs the Go (race) and web tests.

## Quick-save bookmarklet

In **Settings → Articles & feeds**, copy the bookmarklet to your bookmarks bar, or open `<APP_URL>/save#url=<encoded_url>`.
