# Project guide

## Purpose

留白 is a self-hosted read-later and feed reader: a user saves web pages to read later, subscribes to feeds and groups them into folders, and reads the articles in one place. It is a pnpm workspace managed with Turborepo:

- `apps/reader` — the product: the HTTP contract (`src/contract`), the Effect HttpServer with Better Auth and the refresh queue and scheduler (`src/server`), and the SolidJS 1 SPA (`src/web`).
- `packages/business` — the business core: entities, ports and use cases for feeds, folders, feed items, saved pages and settings.
- `packages/sqlite` — the SQLite adapters: connections, migrations, repositories, in-memory test setup.
- `packages/content` — feed parsing, HTML parsing, article extraction and sanitizing.
- `packages/webpage` — page fetching through Jina or a browser service.

`reader-engineering/deployment.md` is the source of truth for setup, commands, environment variables and deployment; `README.md` is written from it.

## Project skills

Read the relevant skill first:

- [`reader-spec`](.agents/skills/reader-spec/SKILL.md) — what the product does: every domain's numbered rules, screens and interactions, HTTP endpoints, user-visible messages and acceptance scenarios. Its `SKILL.md` indexes the domain files and says when to read each.
- [`reader-engineering`](.agents/skills/reader-engineering/SKILL.md) — how it is built: technology choices and their reasons, packages and dependency direction, the app's internal layout, server assembly, web state and components, testing; database, UI styling and deployment in conditional files.

## Maintaining skills

Skills are organized so that a task needs as few files as possible. A change usually stays inside one domain, so knowledge is grouped by domain, not by layer.

- `reader-spec` has one file per domain. Each domain file uses the same sections, and each fact is written in exactly one of them: **Rules** (numbered, ids stable, never reused), **Interface** (what the user sees and does), **API** (resource paths, parameters, responses, errors and status codes), **Messages** (the Chinese copy: errors, toasts, confirmations, empty states), **Acceptance** (Gherkin scenarios in fenced code blocks). Rules shared by all domains live in `reader-spec/SKILL.md`.
- `reader-engineering/SKILL.md` holds what most code changes need; material needed only for one kind of change (database, styling, deployment) lives in a conditional file that `SKILL.md` names together with when to read it.
- Skills hold what the code cannot say: rules, the reasons behind them, and traps found by running the app. They do not restate signatures, field lists or directory trees; port contracts and entity field notes are JSDoc in the code.
- Change the skill in the same change as the behavior it describes, and keep a domain's rules, interface, API, messages and scenarios consistent with each other.
- Improve the structure when real tasks show it is costly: when a task needed several files that are always read together, merge them; when a file is long and part of it is read only for one kind of change, move that part into a conditional file named from the parent with its reading condition. Split by what is read together, never by layer. Prefer a few long files to many short ones; there is no line cap for skill files. Record a structural change in the summary of the change that makes it.

## Writing Effect code (Effect 4)

This project uses Effect **4** (see `packages/*/package.json` for the exact version). Most Effect examples you remember are Effect 2/3 and are often wrong here. Do not write Effect code from memory:

1. Before using an Effect API you have not seen in this repository, find its definition in `node_modules/effect/src/` (the installed version) and read its JSDoc and signature.
2. For usage patterns, read `LLMS.md` and the matching topic in `ai-docs/src/` (`01_effect`, `50_http-client`, `51_http-server`, `09_testing`, …) of the Effect repository at the installed version's tag, cloned to `.slim/repositories/effect` by the `clone-reference-repositories` skill (git-ignored; reuse an existing clone at that tag).
3. Follow `LLMS.md` for the shape of Effect code: a reusable function that returns an Effect is written with `Effect.fn("name")` (exported operations) or `Effect.fnUntraced` (private helpers), never as a plain function that only returns `Effect.gen`; `Effect.gen` is for inline programs, Layer bodies and handler bodies. Where a project skill states a different rule, the skill wins.
4. If the types refuse a straightforward use of an API, re-read its definition before adding casts, overloads or `as never`. A cast needs a comment saying which Effect type it works around.
5. Cross the Promise/Effect boundary once, at the outermost point where the other side is needed. Do not wrap a Promise in an Effect (`Effect.promise`, `Effect.tryPromise`) only to run it back into a Promise (`Effect.runPromise`, `runtime.runPromise`) a line later, or the reverse. If the caller needs an Effect, keep the whole chain in Effect and convert the Promise APIs where they are called; if the caller needs a Promise and nothing in between uses Effect, await the Promise directly.

## Workflow

- Business behavior is defined by the numbered rules in the `reader-spec` skill. Change its domain files in the same change as the behavior they describe.
- Add no length, size, batch, page-size, timeout or concurrency limit and no defensive policy until running the application shows it is needed.
- Robustness comes from the API: decode and validate every input there and fail a wrong one. Forms keep their validation, but quick actions (mark read, mark all, move, delete) get no disabled states, pending tracking or guards; send the request and let the server ignore empty lists and unknown ids (`reader-spec` Client conventions).
- One domain has one name in every layer: `feed`, `folder`, `feed-item`, `saved-page` and `setting` in every package and in `apps/reader` (including the web modules). User-facing names (`稍后阅读`, routes such as `/later`) may differ.
- The project is in development: do not add data migrations or backward compatibility for stored data. When a schema or embedded-engine change makes an existing database unusable, delete it and rebuild with `pnpm db:migrate`.
- Before finishing changes, run `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm build`.

## Import boundaries

Import direction between layers is enforced by `noRestrictedImports` overrides in `biome.json`, and `pnpm check` fails on a violation. Each message names the skill that explains the boundary.

- The dependency direction is in the `reader-engineering` skill (Packages); `biome.json` must match it.
- Do not silence a boundary with `biome-ignore`. If a boundary blocks an import that the design needs, change the boundary in `biome.json` and the skill that describes it in the same change, and say so in the summary.
- When adding a package or a directory that is a new layer, add its override in the same change.

## Modules and file size

Files are capped at 300 non-blank lines (`biome.json`). The cap is a signal that a module boundary is wrong, not a target to split around.

When a file outgrows the cap:

1. First decide whether it holds more than one concept. Split by concept, so that each new module owns its own state and types and exposes a small interface (for example `models/library/folders/` owning folder state, instead of `folder-mutations.ts` and `folder-collapse.ts` sharing one store).
2. Do not split by kind of operation (`mutations.ts`, `read.ts`, `loading.ts`) when every part still takes the same shared state; that adds files without reducing coupling.
3. A module that becomes a directory keeps its name (`feed-item/create.ts`, `feed-item/list.ts`), not sibling files that differ by a suffix. This holds for production code and tests alike.

## Docker

Keep the Docker runtime independent of the workspace: compiled server, web assets in `public/`, and the server's production dependencies only; start Node directly and inject configuration through Docker environment variables. See `reader-engineering/deployment.md` for the layout and commands.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
