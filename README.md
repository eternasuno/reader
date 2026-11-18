# 留白

留白 is a self-hosted read-later and feed reader. Save web pages to read later, subscribe to RSS, Atom, RDF and JSON feeds, group feeds into folders, and read everything in one place. Each account sees only its own data, and the UI is in Chinese.

## Workspace

One pnpm workspace (`reader-workspace`) managed with Turborepo; one app, `reader`, ships everything (package and image name `reader`).

- `apps/reader` — the product: the HTTP contract (`src/contract`), the Effect HttpServer with Better Auth and the feed refresh queue and scheduler (`src/server`), and the SolidJS 1 SPA (`src/web`).
- `packages/business` — the business core: entities, ports and use cases for feeds, folders, feed items, saved pages and settings.
- `packages/sqlite` — the SQLite adapters: connections, migrations, repositories and the in-memory test setup.
- `packages/content` — feed parsing, HTML parsing, article extraction and sanitizing.
- `packages/webpage` — page fetching through Jina or a browser service.

See [`AGENTS.md`](AGENTS.md) for the project guide and the skills that describe the product and the engineering rules.

## Requirements

- Node `>=22.19` (the `engines` floor that `node:sqlite` requires; the container builds on Node 24).
- pnpm `12.3.4`, pinned in the root `package.json`.

## Setup

```sh
pnpm install
cp apps/reader/.env.example apps/reader/.env
```

Replace `BETTER_AUTH_SECRET` in `apps/reader/.env` with a long random value, for example from `openssl rand -base64 32`.

## Commands

| Command            | Does                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`         | `dev:web` (Vite) and `dev:server` (`tsx watch --env-file-if-exists=.env src/server/main.ts`), each as its own persistent task |
| `pnpm build`       | the server bundle and the web build, both into `apps/reader/dist` (`dist/server.js`, `dist/public`)                           |
| `pnpm start`       | the built server (`cd dist && node --env-file-if-exists=../.env server.js`)                                                   |
| `pnpm db:migrate`  | Better Auth's migrations against `auth.db` and the reader migration against `reader.db`                                       |
| `pnpm test`        | every Vitest suite                                                                                                            |
| `pnpm typecheck`   | TypeScript across every package and both app tsconfig files, tests included                                                   |
| `pnpm check`       | Biome lint and format for JavaScript, TypeScript, CSS and JSON                                                                |
| `pnpm check --fix` | the same, applying safe fixes                                                                                                 |

## Development

`pnpm dev` runs two persistent Turborepo tasks:

- `dev:web` serves the web with Vite on `WEB_PORT` (default `3000`).
- `dev:server` runs the server with `tsx watch --env-file-if-exists=.env src/server/main.ts` on `API_PORT` (default `3001`).

Vite proxies `/api` to the server, so the browser talks to one origin during development and the server needs no CORS middleware. The proxy target is read from the same `API_PORT` the server reads (the app's `.env`), so one value configures both.

In development the server runs from `apps/reader` with `tsx`, so its working directory holds no `public/` unless a build ran there. The web comes from the Vite dev server and nothing is served statically, which makes the static layer irrelevant in development.

The web's Vite config builds with the Solid plugin (`ssr: false`) and the Tailwind plugin, reads its environment from the app directory, and uses `strictPort` so a busy port fails loudly instead of silently moving to another one. Vitest runs from the same configs with `environment: 'node'`.

## Environment variables

| Variable             | Default                 | Read by                 | Purpose                                                                                                    |
| -------------------- | ----------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `API_PORT`           | `3001`                  | server, Vite dev proxy  | port of the HTTP server (also the proxy target in development and the public port in the container)        |
| `WEB_PORT`           | `3000`                  | Vite dev/preview server | dev and preview port for the web; not used by the built app                                                |
| `DATA_DIR`           | `.data`                 | server, `db:migrate`    | directory holding `reader.db` and `auth.db`, relative to the process working directory, created if missing |
| `BETTER_AUTH_SECRET` | — (required)            | server                  | Better Auth signing secret                                                                                 |
| `BETTER_AUTH_URL`    | `http://localhost:3000` | server                  | canonical public origin used for auth URLs and the `Origin` check on state-changing requests               |
| `TZ`                 | the system zone         | server                  | time zone of the process; decides the date of a Kindle send and when the daily send time comes due         |

Deploy the web and `/api` on one public origin, set `BETTER_AUTH_URL` to it, and terminate HTTPS in a reverse proxy in front of the app.

Local development reads `.env` files (`--env-file-if-exists`); the container never does. Inject every container value through Docker environment variables, and keep environment files out of the build context.

## Docker

The build stage installs the pinned pnpm, runs `pnpm install --frozen-lockfile` and `pnpm build`, exports the server's production deployment directory (`pnpm --filter reader deploy --prod`) and creates `/data` owned by `node` (UID 1000). The runtime stage starts from `node:24-bookworm-slim`, copies only that `node_modules` and the build output (`dist/server.js` as `server.js`, `dist/public` as `public/`), sets `NODE_ENV=production`, creates `/data` owned by `node`, switches to the non-root `node` user and runs `node server.js`. Both stages create `/data` because a fresh named volume takes its ownership from the image that first mounts it, and that image is the build stage when the migration runs before the first start.

The runtime image contains no migration tooling, so apply the schema with the application stopped, the same `DATA_DIR` and the build stage as a migration image. The order is: build both images, create the volume, migrate into it, then start the service.

```sh
docker build -t reader .
docker build --target build -t reader-migrate .
docker volume create reader-data
docker run --rm --init \
  -e BETTER_AUTH_SECRET \
  -e DATA_DIR=/data \
  -v reader-data:/data \
  --user 1000:1000 \
  reader-migrate pnpm db:migrate
docker run --rm --init \
  -p 3001:3001 \
  -e BETTER_AUTH_SECRET \
  -e API_PORT=3001 \
  -e BETTER_AUTH_URL=http://localhost:3001 \
  -e DATA_DIR=/data \
  -e TZ=Asia/Shanghai \
  -v reader-data:/data \
  reader
```

- Set `API_PORT` and map the same container port with `-p` (`-e API_PORT=8080 -p 8080:8080`).
- Export a strong `BETTER_AUTH_SECRET` in the host environment before running these commands; `-e BETTER_AUTH_SECRET` without a value forwards it from the host.
- The container runs in UTC unless `TZ` is set; the Kindle daily send time is read in that zone.
- The image ships no browser. Browser extraction connects to a CDP-compatible browser service the user runs and saves in the settings; inside the container `localhost` is the container, so the address must be reachable from it.
- `/data` must be writable by UID 1000, the migration container's user and the runtime's `node`: a fresh named volume inherits the ownership the image gives `/data`, and a bind mount must be made writable by that uid.
- Do not mount the same database into concurrent replicas: SQLite has one write lock and one file.
- Never apply migrations automatically at startup: a restart loop would race the deployed instances instead of migrating once.

## Production serving

Assemble the runtime directory (`server.js`, `public/`, production `node_modules`) and start it from there:

```sh
NODE_ENV=production node server.js
```

The server answers `/api/*` and the static routes on `API_PORT`; the browser loads the app from `/` and the article iframe loads the shared stylesheet from the same origin, so the app must not be split across two origins.
