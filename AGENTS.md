# Project guide

## Purpose

Self-hosted starter with a pure SolidJS 1 SPA and a separate Effect HttpServer API using Better Auth and embedded SurrealDB/SurrealKV. It is a pnpm workspace managed with Turborepo.

## Project skills

Read the relevant skill first when the task involves:

- [`project-architecture`](.agents/skills/project-architecture/SKILL.md) — SolidJS routes or components, browser/API boundaries, frontend session subscriptions, or deployment topology.
- [`project-effect-api`](.agents/skills/project-effect-api/SKILL.md) — Better Auth paths, session identity, protected APIs, business ports and use cases, repository and paging contracts, Effect services, or Layer composition.
- [`project-database`](.agents/skills/project-database/SKILL.md) — SurrealDB/SurrealKV runtime connections, queries, Better Auth schema migrations, or database deployment configuration.
- [`project-testing`](.agents/skills/project-testing/SKILL.md) — tests, test doubles, Effect Layer assembly, or in-memory database schema initialization.

## Workflow

- Treat `README.md` as the source of truth for setup, commands, environment variables, routes, and deployment details.
- Keep Docker runtime independent of the workspace: compiled API, Web assets in `public/`, and API production dependencies only; start Node directly and inject configuration through Docker environment variables. See README for the maintained layout and commands.
- The project is in development: do not add data migrations or backward compatibility for stored data. When a schema or embedded-engine change makes an existing database unusable, delete it and rebuild with `pnpm db:migrate`.
- Before finishing changes, run `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
