# Project guide

## Purpose

A self-hosted read-later and feed reader: a user saves web pages to read later, subscribes to feeds and groups them into folders, and reads the articles in one place. It is a pnpm workspace managed with Turborepo:

- `apps/web` — a pure SolidJS 1 SPA.
- `apps/api` — an Effect HttpServer API with Better Auth and embedded SQLite via `node:sqlite`; it also runs the feed refresh queue and scheduler.
- `packages/business` — the business core: entities, ports and use cases for feeds, feed folders, saved pages and settings.
- `packages/sqlite` — the `@reader/sqlite` adapter for the business ports: the reader and Better Auth SQLite connections, reader store schemas and repositories, the feed refresh listing query, and the test setup exported from `@reader/sqlite/testing`.
- `packages/api` — the library HTTP contract shared by the API and the web client.
- `packages/webpage` — page fetching through Jina or a browser service.

`README.md` is the source of truth for setup, commands, environment variables, routes and deployment.

## Project skills

Read the relevant skill first when the task involves:

- [`project-business`](.agents/skills/project-business/SKILL.md) — business behavior: the numbered rules (`FD-`, `SP-`, `SET-`, `CM-`) for feeds, folders, feed items, saved pages and settings, and the decisions behind them.
- [`project-architecture`](.agents/skills/project-architecture/SKILL.md) — SolidJS routes, components and models; reader and settings UI behavior and its acceptance scenarios; accounts in the browser; deployment topology.
- [`project-effect-api`](.agents/skills/project-effect-api/SKILL.md) — Better Auth, session identity, HTTP handlers and error mapping, adapters, the refresh queue and scheduler, Layer composition.
- [`project-database`](.agents/skills/project-database/SKILL.md) — the `@reader/sqlite` package: SQLite connections, queries, indexes, migrations and database deployment configuration.
- [`project-testing`](.agents/skills/project-testing/SKILL.md) — where each rule is tested, contract suites, test doubles and in-memory database setup.

Skills hold what the code cannot say: rules, the reasons behind them, and traps found by running the app. They do not restate signatures, field lists or directory trees; read the code for those.

## Writing Effect code (Effect 4)

This project uses Effect **4** (see `packages/*/package.json` for the exact version). Most Effect examples you remember are Effect 2/3 and are often wrong here. Do not write Effect code from memory:

1. Before using an Effect API you have not seen in this repository, find its definition in `node_modules/effect/src/` (the installed version) and read its JSDoc and signature.
2. For usage patterns, read `.repos/effect/LLMS.md` and the matching topic in `.repos/effect/ai-docs/src/` (`01_effect`, `50_http-client`, `51_http-server`, `09_testing`, …). Run `pnpm effect:source` first if `.repos/effect` is missing; it clones the Effect repository at the installed version's tag.
3. Follow `LLMS.md` for the shape of Effect code: a reusable function that returns an Effect is written with `Effect.fn("name")` (exported operations) or `Effect.fnUntraced` (private helpers), never as a plain function that only returns `Effect.gen`; `Effect.gen` is for inline programs, Layer bodies and handler bodies. Where a project skill states a different rule, the skill wins.
4. If the types refuse a straightforward use of an API, re-read its definition before adding casts, overloads or `as never`. A cast needs a comment saying which Effect type it works around.
5. Cross the Promise/Effect boundary once, at the outermost point where the other side is needed. Do not wrap a Promise in an Effect (`Effect.promise`, `Effect.tryPromise`) only to run it back into a Promise (`Effect.runPromise`, `runtime.runPromise`) a line later, or the reverse. If the caller needs an Effect, keep the whole chain in Effect and convert the Promise APIs where they are called; if the caller needs a Promise and nothing in between uses Effect, await the Promise directly.

## Workflow

- Business behavior is defined by the numbered rules in the `project-business` skill. Change its rule files in the same change as the behavior they describe.
- Add no length, size, batch, page-size, timeout or concurrency limit and no defensive policy until running the application shows it is needed.
- One domain has one name in every layer: `feed`, `folder`, `feed-item`, `saved-page` and `setting` in `packages/business`, `packages/sqlite`, `apps/api` and `apps/web`.
- The project is in development: do not add data migrations or backward compatibility for stored data. When a schema or embedded-engine change makes an existing database unusable, delete it and rebuild with `pnpm db:migrate`.
- Before finishing changes, run `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm build`.

## Import boundaries

Import direction between layers is enforced by `noRestrictedImports` overrides in `biome.json`, and `pnpm check` fails on a violation. Each message names the skill that explains the boundary.

- Package direction: `packages/business` imports only `effect`; `packages/sqlite` imports `packages/business`, `effect`, `@effect/sql-sqlite-node` and `node:` modules, never `apps/api`; `apps/api` depends on `@reader/sqlite` for its databases, but `http/` never imports it. The API alone owns the Better Auth integration, the migration orchestration and the refresh loop.
- Do not silence a boundary with `biome-ignore`. If a boundary blocks an import that the design needs, change the boundary in `biome.json` and the skill that describes it in the same change, and say so in the summary.
- When adding a package or a directory that is a new layer, add its override in the same change.

## Modules and file size

Files are capped at 300 non-blank lines (`biome.json`). The cap is a signal that a module boundary is wrong, not a target to split around.

When a file outgrows the cap:

1. First decide whether it holds more than one concept. Split by concept, so that each new module owns its own state and types and exposes a small interface (for example `models/library/folders/` owning folder state, instead of `folder-mutations.ts` and `folder-collapse.ts` sharing one store).
2. Do not split by kind of operation (`mutations.ts`, `read.ts`, `loading.ts`) when every part still takes the same shared state; that adds files without reducing coupling.
3. A module that becomes a directory keeps its name (`feed-item/create.ts`, `feed-item/list.ts`), not sibling files that differ by a suffix. This holds for production code and tests alike.

## Docker

Keep the Docker runtime independent of the workspace: compiled API, Web assets in `public/`, and API production dependencies only; start Node directly and inject configuration through Docker environment variables. See README for the maintained layout and commands.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
