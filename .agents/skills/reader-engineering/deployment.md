---
name: reader-deployment
description: Conditional file of the reader-engineering skill. Read when touching builds, the Vite configuration, static serving, environment variables, the data directory or Docker.
---

# Deployment

One app, `apps/reader`, ships everything: it builds the server bundle and the web assets, the server serves both, and one process and one image run them. Package and image name `reader` (the root workspace package is `reader-workspace`, so `pnpm --filter reader` targets the app alone); the product is 留白.

This file is the source of truth for setup, commands, environment variables and deployment; `README.md` is written from it and the two must stay in agreement.

## Build and runtime layout

- Both bundles come from Vite: the server SSR build (`vite.server.config.ts`) and the SPA build (`vite.config.ts`). `pnpm build` writes them into the app's build output, `apps/reader/dist`: `dist/server.js` first (which empties `dist/`), then `dist/public` for the web assets.
- The runtime directory is a separate thing from the build output: the Docker image's `/app` holds `server.js`, `public/` and the server's production `node_modules`, with no `dist/` level and no workspace paths.
- The runtime must not depend on the workspace: no pnpm, no Turbo, no development dependencies, no workspace-relative asset paths. Start Node directly on `server.js` and pass configuration through environment variables.
- Static routes are mounted once, through a single static-server layer with the fixed root `public`, resolved from the process working directory — which the runtime directory makes correct, since `public/` sits beside `server.js`. Whether that directory exists needs no environment branch and no startup filesystem check, and the layer does not validate `index.html` at startup.
- Unmatched extensionless `GET`/`HEAD` requests that accept HTML fall back to `index.html`, including paths under `/api/*` and `/assets/*`. A path with a file extension answers 404. Every static response carries `Cache-Control: no-cache`, so a client revalidates instead of reusing a stale asset after a deploy.
- No schema is applied at startup (`database.md`).

## Setup

- Node `>=22.19` (the `engines` floor that `node:sqlite` requires; the container builds on Node 24) and pnpm `12.3.4`, pinned in the root `package.json`.
- `pnpm install`, then create the app's local environment file from `apps/reader/.env.example` and replace `BETTER_AUTH_SECRET` with a long random value (`openssl rand -base64 32`).
- Internal workspace packages export TypeScript source (`./src/index.ts`) and are bundled into `dist/server.js` by `vite.server.config.ts`. Any library kept external by `ssr.external` in `vite.server.config.ts` (`@mozilla/readability`, `dompurify`, `feedsmith`, `fflate`, `jsdom`, `nodemailer`, `puppeteer-core`, `ws`) remains a runtime import of `dist/server.js` and must also be a direct `dependencies` entry of `apps/reader/package.json` — otherwise pnpm's strict `node_modules` (both locally and after `pnpm --filter reader deploy --prod`) links it only under the adapter package and `node server.js` fails to resolve it. TypeScript `include`/`exclude` does not control bundler externalization, and the pinned pnpm supports the default `deploy` (no `--legacy`).

## Commands

| Command | Does |
| --- | --- |
| `pnpm dev` | `dev:web` (Vite) and `dev:server` (`tsx watch --env-file-if-exists=.env src/server/main.ts`), each as its own persistent Turborepo task |
| `pnpm build` | the server bundle and the web build, both into `apps/reader/dist` (`dist/server.js`, `dist/public`) |
| `pnpm start` | the built server (`cd dist && node --env-file-if-exists=../.env server.js`) |
| `pnpm db:migrate` | Better Auth's migrations against `auth.db` and the reader migration against `reader.db` |
| `pnpm test` | every Vitest suite |
| `pnpm typecheck` | TypeScript across every package and both app tsconfig files, tests included (`SKILL.md`) |
| `pnpm check` | Biome lint and format for JavaScript, TypeScript, CSS and JSON |
| `pnpm check --fix` | the same, applying safe fixes |

## Development

- Development runs two persistent Turborepo tasks (`pnpm dev`): `dev:web` serves the web with Vite on `WEB_PORT` (default 3000), and `dev:server` runs the server with `tsx watch --env-file-if-exists=.env src/server/main.ts` on `API_PORT` (default 3001).
- Vite proxies `/api` to the server, so the browser talks to one origin during development and the server needs no CORS middleware. The proxy target is read from the same `API_PORT` the server reads (the app's `.env`), so one value configures both and nothing is duplicated.
- In development the server runs from `apps/reader` with `tsx`, so its working directory holds no `public/` unless a build ran there. The web comes from the Vite dev server and nothing is served statically, which makes the static layer irrelevant in development; that needs no environment branch.
- The web's Vite config builds with the Solid plugin (`ssr: false`) and the Tailwind plugin, reads its environment from the app directory, and uses `strictPort` so a busy port fails loudly instead of silently moving to another one.
- Vitest runs from the same configs with `environment: 'node'`; the `solid-js` alias must stay an exact-match regex (`/^solid-js$/`) — a string key also rewrites `solid-js/store` and `solid-js/web` and breaks Better Auth's Solid client.

## Environment variables

| Variable | Default | Read by | Purpose |
| --- | --- | --- | --- |
| `API_PORT` | `3001` | server, Vite dev proxy | port of the HTTP server (also the proxy target in development and the public port in the container) |
| `WEB_PORT` | `3000` | Vite dev/preview server | dev and preview port for the web; not used by the built app |
| `DATA_DIR` | `.data` | server, `db:migrate` | directory holding `reader.db` and `auth.db`, relative to the process working directory, created if missing |
| `BETTER_AUTH_SECRET` | — (required) | server | Better Auth signing secret |
| `BETTER_AUTH_URL` | `http://localhost:3000` | server | canonical public origin used for auth URLs and the `Origin` check on state-changing requests |
| `TZ` | the system zone | server | time zone of the process, which decides the server-local date of a Kindle send and the instant its daily send time comes due (KD-SCHED-1) |

- Deploy the web and `/api` on one public origin, set `BETTER_AUTH_URL` to it, and terminate HTTPS in a reverse proxy in front of the app.
- Local development reads `.env` files (`--env-file-if-exists`); the container never does. Inject every container value through Docker environment variables, and keep environment files out of the build context.

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
  -v reader-data:/data \
  reader
```

- Set `API_PORT` and map the same container port with `-p` (`-e API_PORT=8080 -p 8080:8080`).
- The container's time zone is UTC unless `TZ` is set, so a saved send time would fire in UTC: pass the zone you mean, `-e TZ=Asia/Shanghai` (KD-SCHED-1).
- Export a strong `BETTER_AUTH_SECRET` in the host environment before running these commands; `-e BETTER_AUTH_SECRET` without a value forwards it from the host.
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
