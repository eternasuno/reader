---
name: project-testing
description: Follow the project's behavior and test-directory boundaries when writing or adjusting tests, test doubles, Effect Layer assembly, or in-memory database schema initialization.
---

# Project Testing

- Tests should verify only observable behavior owned by the project, such as project configuration, error conversion, service projections, route composition, and custom codecs; do not test third-party library behavior itself.

The business core implements the specs in `docs/`. Before changing business contracts or layout, read `docs/README.md` and the relevant `docs/usecases` spec; its "Outer-layer behavior to keep" lists behavior outside the specs that must survive changes.

- Mirror the responsibilities of `src` in test directories and filenames: app tests mirror `apps/<app>/src/<area>/` under `apps/<app>/test/<area>/`; business tests mirror `packages/business/src/<entity|usecase>/<domain>/` under `packages/business/test/<entity|usecase>/<domain>/`.
- Prefer real Layers; use `Layer.mock` when a substitute is needed. When behavior is only simple third-party library assembly with no project-specific behavior, do not create tests merely to increase coverage.
- When adding or changing behavior, define the project behavior assertion first, then implement it; keep tests aligned with boundaries, identity sources, and resource lifecycles.
- Write one contract test suite per repository port and run it against the SurrealDB implementation and every test double, so a double cannot drift from the port. Suites and in-memory doubles live in the flat `packages/business/test/port/` (`*-contract.ts`, `memory-*.ts`) and are exported from `@reader/business/testing`; `apps/api/test/adapter/*-store.test.ts` runs them against SurrealDB. Business use-case tests use the in-memory repository doubles and `Layer.mock` only for non-repository ports. Cases follow the port contract (CM-PORT) and the Ports section of the domain spec; do not duplicate those cases here.
- Cover URL uniqueness in the repository contract suite: concurrent creates of the same URL in one scope leave exactly one row and the others are skipped, not overwritten. The rules live in `docs/usecases/common.md` CM-PORT.
- Do not assert exact id values; assert uniqueness and order. Ids come from the entity constructor default `Model.UuidV7WithGenerate` (`docs/usecases/common.md` CM-ID).
- When backend tests initialize `mem://`, call the SurrealDB adapter's `createSchema` directly and initialize the reader-store schema when exercising library persistence; do not rely on production migration side effects in tests.
- For library response regressions, exercise the real HTTP handler and decode its JSON with the browser's response schema. Include absent optional fields from stored rows; calling the use case alone does not verify HTTP encoding. When moving error mapping to routes, cover the public status, error tag/message, and any retained entity ID through HTTP. Choose fixtures that actually reach the failing dependency: feed HTML parsing and sanitization require article content; test omission with a record whose field is absent.
- Beyond the contract suite, add explicit owner-isolation tests for feed items and saved pages (CM-OWN): foreign or unknown ids read as absent and change nothing.
- For unread counts, cover that the feed counts and the saved-page count are served by their two separate endpoints. For the refresh queue, cover per-feed deduplication, the bound on parallel jobs, and that one failing feed is logged without stopping the rest (`docs/usecases/feed.md` FD-SCHED).
- Frontend test scripts should not use `--passWithNoTests`; a missing web test suite should fail visibly rather than silently pass.
- Test browser-independent frontend state and validation logic in the existing Node/Vitest environment. Add a DOM environment only when the behavior under test depends on rendered DOM interactions.
- Keep the web Vitest `solid-js` alias in `apps/web/vite.config.ts` an exact-match regex (`/^solid-js$/`); a string key also rewrites `solid-js/store` and `solid-js/web` and breaks Better Auth's Solid client in tests.
- Paging tests go through the repository contract suite and page with ids as cursors; the cases follow `docs/usecases/common.md` CM-PAGE.
