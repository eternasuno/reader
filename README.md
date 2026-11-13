# Solid Effect Starter

A self-hosted pnpm/Turborepo starter with a pure SolidJS 1 client application and a separate Effect HTTP API backed by Better Auth and embedded SurrealDB/SurrealKV. The UI uses Tailwind CSS v4 and DaisyUI v5.

## Prerequisites

- Node.js **22.19 or newer**
- pnpm **12.3.4**

Install dependencies and create the local configuration files:

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Replace `BETTER_AUTH_SECRET` in `apps/api/.env` with a long random value, for example from `openssl rand -base64 32`.

## Development

```sh
pnpm dev
```

By default:

- Web SPA: `http://localhost:3000`
- Effect API: `http://localhost:3001`

Both applications run as independent Turborepo tasks. Vite proxies `/api` to the Effect server during development and preview, so browser authentication remains same-origin without API CORS middleware.

Jina is the default extraction provider and supports anonymous access; an API key is optional. To use browser extraction, install and start a CDP-compatible browser service separately, such as Obscura with `obscura serve --port 9222`, then save its address in the standalone settings page. Switching providers preserves their saved configuration and extracted articles.

The server uses `puppeteer-core` to connect to the configured browser and opens a page for each extraction. Both providers return HTML to the same local Readability extraction and sanitization pipeline. The implementations live in `packages/webpage`. Browser extraction waits for network activity to settle; pages with long polling or delayed rendering can still time out or need the original site.

Production browser extraction requires a separately running CDP-compatible browser service such as Obscura, Lightpanda, or Chromium. The API image does not install or launch a browser. Each user saves their browser service address in the reader settings, using an HTTP discovery URL or a full WebSocket endpoint. The API connects to that address; in Docker, localhost refers to the API container, so use the browser service's reachable address. Keep browser services private and expose this self-hosted application only to trusted users who may configure endpoints reachable from the API. The API adds no address, size, time or concurrency limits to page or feed fetching.

## Commands

```sh
pnpm dev        # run the web and API development servers
pnpm build      # build both applications
pnpm start      # run the built API server
pnpm test       # run all Vitest suites
pnpm check      # run Biome checks, including Markdown and YAML formatting
pnpm check --fix  # run Biome checks and apply fixes
pnpm typecheck  # run TypeScript checks for both applications
```

## Project guidance

Maintainers should read [`AGENTS.md`](AGENTS.md) first, then read the relevant project skill for the task:

- [`project-business`](.agents/skills/project-business/SKILL.md) — business rules: feeds, feed items, saved pages, settings, ids, paging, refresh and retention, with numbered rules that tests refer to.
- [`project-architecture`](.agents/skills/project-architecture/SKILL.md) — architecture, reader and settings UI behavior, browser/API boundaries, session subscriptions, or deployment topology.
- [`project-effect-api`](.agents/skills/project-effect-api/SKILL.md) — Better Auth, sessions, protected APIs, HTTP handlers and error mapping, the feed refresh queue, Effect services, or Layer composition.
- [`project-database`](.agents/skills/project-database/SKILL.md) — SurrealDB/SurrealKV connections, queries, schema migrations, or database deployment configuration.
- [`project-testing`](.agents/skills/project-testing/SKILL.md) — tests, test doubles, Effect Layers, or in-memory database schema setup.

## Architecture

```text
Browser
  -> apps/web: static SolidJS SPA
  -> credentialed HTTP requests
  -> apps/api: Effect HttpServer
       -> Better Auth
       -> SurrealDB / SurrealKV
```

- `apps/web` contains browser-only routes, components, and the Better Auth client. Vite builds static assets with `ssr: false`; there are no server functions or server runtime modules.
- `apps/api/src/http` owns HTTP routing: the library handlers under `http/library/`, the Better Auth and static routes, and the origin and session middleware. Better Auth handles `/api/auth/*`.
- `apps/api/src` is grouped by responsibility: `store/` holds the SurrealDB repositories and schema, `content/` the feed parser, HTML parser, article extractor and sanitizer, `refresh/` the feed refresh queue and scheduler, `auth.ts` the Better Auth layer and `db/` the database connection. `apps/api/src/app.ts` composes them into the HTTP `AppLive`, and `apps/api/src/server.ts` is the process entry that launches it. The server entry owns layer acquisition and graceful shutdown via `NodeRuntime`.
- `apps/api/test` tests the database, the authentication protocol, and HTTP handlers against `mem://`.

### Security boundaries

The backend derives identity only from the Better Auth session cookie on the incoming request. It never accepts a client-supplied user ID as identity. Database clients, embedded engines, secrets, and Better Auth server configuration stay in `apps/api` and cannot enter the browser bundle.

Better Auth owns `/api/auth/*`; application endpoints should not reimplement its protocol. Protected endpoints use the `Authentication` middleware declared in `packages/api/src/middleware.ts` and derive identity from `Session`; its implementation lives in `apps/api/src/http/middleware/session.ts`.

### Embedded SurrealDB

`apps/api/src/db/index.ts` connects to the configured database and selects its namespace and database. Runtime startup does not generate or apply schema.

Better Auth's `auth migrate` command only supports its built-in Kysely adapter, so for the SurrealDB adapter the CLI can only emit DDL. Apply the schema with the package script:

```sh
pnpm --filter api db:migrate
```

The script derives the DDL from the adapter and applies it to the configured database. Apply schema during deployment rather than at startup, so changes are applied once instead of racing across restarted instances. Tests initialize the adapter schema directly against `mem://`.

The project is in development and keeps no database compatibility or data migration path. `@surrealdb/node` 3.2 embeds SurrealDB 4.0, which refuses to open a SurrealKV directory written by SurrealDB 3.x. After an engine or schema change that makes existing data unusable, delete the directory named by `SURREAL_ENDPOINT` (for example `.data/database`) and run `pnpm db:migrate` again.

## Environment variables

Web variables belong in `apps/web/.env`:

| Variable   | Default | Purpose                      |
| ---------- | ------- | ---------------------------- |
| `WEB_PORT` | `3000`  | Web development/preview port |

API variables belong in `apps/api/.env`:

| Variable             | Default                 | Purpose                                                                                                              |
| -------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `API_PORT`           | `3001`                  | Effect HTTP server port                                                                                              |
| `SURREAL_ENDPOINT`   | `mem://`                | Database endpoint; defaults to ephemeral `mem://`; use an absolute SurrealKV path or managed endpoint in production. |
| `SURREAL_NAMESPACE`  | `app`                   | SurrealDB namespace                                                                                                  |
| `SURREAL_DATABASE`   | `app`                   | SurrealDB database                                                                                                   |
| `BETTER_AUTH_SECRET` | —                       | Better Auth signing secret                                                                                           |
| `BETTER_AUTH_URL`    | `http://localhost:3000` | Canonical public site origin used for auth URLs                                                                      |

Deploy the frontend and `/api` on the same public origin. In development and preview, Vite provides the `/api` proxy.

## Routes

### Web

- `/register` — email/password registration
- `/login` — email/password login
- `/` — protected later reading list; redirects to `/login` when no session exists
- `/rss` — subscribed Feed articles
- `/read/link/:key` — selected saved page
- `/read/feed/:feedId/:key` — selected feed item
- `/settings` — account, article retention, and extraction settings

### API

- `/api/auth/*` — Better Auth protocol
- `/api/library/saved-pages*` — authenticated read-later pages: list, find by id or URL, add a link, save a feed item, mark read, mark all read, remove, unread count
- `/api/library/feeds*` — subscriptions: list, preview, subscribe (optionally into a folder), unsubscribe, move to a folder or the top level, mark feeds read, mark all read, per-feed unread counts; `/api/library/feeds/items*` — feed items: list all (`/items`), list one feed (`/items/by-feed?feedId`), list one folder (`/items/by-folder?folderId`), find, extract, mark read
- `/api/library/folders*` — folders grouping feeds: list, create, rename, remove (unsubscribes its feeds), mark folders read
- `/api/library/settings*` — read the settings (only whether the Jina key and the browser address are configured), set retention, use Jina (`/settings/fetcher/jina`, optional key), use the browser service (`/settings/fetcher/browser`, optional address), clear the Jina key

The endpoint contract lives in `packages/api`. List endpoints take `limit` (a positive integer), `unreadOnly` and an optional `cursor`, which is the id of the last row of the previous page; feed items and saved pages are listed newest first by id. There is no background reload: clients list again from the first page to see new rows.

Subscribing creates the feed with the previewed title and queues its first refresh; items arrive with that refresh. The API process refreshes every feed through one queue at start and every 30 minutes, at most 3 feeds at a time, and drops a request for a feed that already has a refresh queued or running.

Business storage keeps `feed`, `folder`, `feed_item` and `saved_page` scoped by owner, with version-7 UUID ids and a unique URL per owner (feeds, saved pages) or per feed (items); folder names are unique per owner, and removing a folder removes its feeds and their items. Stored data is not migrated between schema changes; delete the database and run `pnpm db:migrate` against a fresh one.

## Production

Build both applications:

```sh
pnpm build
```

The API always mounts static routes for `public/`. Development uses Vite and its API proxy; Web builds remain in `apps/web/dist`, so the API's `public/` directory is absent during development. A missing static directory does not prevent startup; requests for missing files return 404. In production, assemble a single runtime directory containing the API build (`server.js`), API production `node_modules`, and the Web build in `public/`. The API serves `public/` relative to the process working directory alongside `/api`. The static layer does not validate `index.html` at startup.

Start from the assembled runtime directory:

```sh
NODE_ENV=production node server.js
```

Unmatched extensionless GET/HEAD paths accepting HTML fall back to `index.html`, including paths under `/api/*` and `/assets/*`. Missing files with extensions return 404. All static files use `Cache-Control: no-cache` for revalidation. Set `BETTER_AUTH_URL` to the public site origin and use HTTPS through a reverse proxy in production.

### Workspace packages

Internal packages may use `workspace:*` dependencies and export TypeScript source (for example, `"exports": "./src/index.ts"`). Workspace package injection is not enabled. Vite normally bundles linked workspace dependencies in the API SSR build; when adding an internal source package, inspect the generated API output for remaining runtime imports. Add `ssr.noExternal` only if needed. TypeScript `include`/`exclude` does not control bundler externalization.

The pinned pnpm 12.3.4 supports default `deploy` without workspace injection (available since 12.2.0), so Docker does not use `--legacy`. Injection controls dependency installation and peer resolution, not whether source or compiled entry points are used.

### Docker

The build stage uses `pnpm build` (Turbo) to build Web and API in parallel, then assembles them into a new runtime image: `/app/server.js`, `/app/public/`, and `/app/node_modules/`. `pnpm --filter api deploy --prod` exports an isolated API deployment directory without development dependencies; only its production `node_modules` are copied. The runtime starts Node directly and does not include workspace configuration, pnpm, Turbo, or project development dependencies.

```sh
docker build -t solid-effect-starter .
docker volume create starter-data
docker run --rm --init \
  -p 3001:3001 \
  -e BETTER_AUTH_SECRET \
  -e API_PORT=3001 \
  -e BETTER_AUTH_URL=http://localhost:3001 \
  -e SURREAL_ENDPOINT=surrealkv:///data/database \
  -v starter-data:/data \
  solid-effect-starter
```

Export a strong `BETTER_AUTH_SECRET` in the host environment before running these commands. Inject all container configuration through Docker environment variables; the runtime does not load `.env` files, and environment files are excluded from the build context. Set `API_PORT` and map the same container port with `-p` (for example, `-e API_PORT=8080 -p 3001:8080`). The image runs as the non-root `node` user. Named volumes inherit the writable `/data` directory; bind mounts must be writable by UID 1000. Replace the example public origin for your deployment. Do not mount the same embedded database into concurrent replicas.

Apply migrations once before starting the service. The minimal runtime image does not include TypeScript migration tooling or source; use the Docker build stage as a separate migration image:

```sh
docker build --target build -t solid-effect-starter-migrate .
docker run --rm --init \
  -e BETTER_AUTH_SECRET \
  -e SURREAL_ENDPOINT=surrealkv:///data/database \
  -v starter-data:/data \
  --user 1000:1000 \
  solid-effect-starter-migrate pnpm --filter api db:migrate
```

Run this with the application stopped and the same namespace/database configuration. Create the named volume with writable ownership for UID 1000 before migration (for example, using the runtime image's `/data` directory). Never apply migrations automatically at startup.

A volume written by an image built with SurrealDB 3.x hits the same refusal described in Embedded SurrealDB: remove the old volume (or use a new one) and run the migration again.
