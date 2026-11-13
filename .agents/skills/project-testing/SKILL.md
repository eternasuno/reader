---
name: project-testing
description: Follow the project's behavior and test-directory boundaries when writing or adjusting tests, test doubles, Effect Layer assembly, or in-memory database schema initialization.
---

# Project Testing

- Tests should verify only observable behavior owned by the project, such as project configuration, error conversion, service projections, route composition, and custom codecs; do not test third-party library behavior itself.

Business tests cover the numbered rules of the `project-business` skill and name the rule they test (for example `SP-ADD-1`). Each rule is tested once, at the layer that owns it; a layer above tests only what it adds. Before deleting a test as a duplicate, find the kept test of the same rule id at the owning layer; if there is none, move the test there instead.

| Layer                      | Tests only                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Entity                     | Value rules: trimming, URL normalization, defaults                                                                                |
| Port contract suite        | Repository behavior: filtering, order, uniqueness, ownership, atomicity, paging with ids as cursors                                |
| Use case                   | Orchestration: which ports are called, how errors are told apart                                                                  |
| HTTP (`apps/api/test/http`) | The boundary: session and origin checks, input decoding, error-to-status mapping, responses that hide secrets, one wired-through case per endpoint |
| Web                        | Response-to-view-model conversion and state logic                                                                                 |

- All test code lives in each package's `test/`. Helpers (test doubles, contract suites, fixtures, network stubs, in-memory database setup) live under that package's `test/support/`, never as a package-level directory and never in `src/`; `src/` imports nothing from `test/`. Test files follow the 300-line rule of `AGENTS.md`: a suite that outgrows it becomes a directory (`usecase/feed/refresh-feed/retention.test.ts`).
- Mirror the responsibilities of `src` in test directories and filenames: app tests mirror `apps/<app>/src/<area>/` under `apps/<app>/test/<area>/`; business tests mirror `packages/business/src/<entity|usecase>/<domain>/` under `packages/business/test/<entity|usecase>/<domain>/`.
- Prefer real Layers; use `Layer.mock` when a substitute is needed. When behavior is only simple third-party library assembly with no project-specific behavior, do not create tests merely to increase coverage.
- When adding or changing behavior, define the project behavior assertion first, then implement it; keep tests aligned with boundaries, identity sources, and resource lifecycles.
- Write one contract test suite per repository port and run it against the SurrealDB implementation and every test double, so a double cannot drift from the port. Suites live in `packages/business/test/support/contract/<domain>/`, in-memory doubles in `packages/business/test/support/memory/`; both are exported from `@reader/business/testing`. `packages/business/test/port/` runs the suites against the doubles and `apps/api/test/store/` against SurrealDB. Business use-case tests use the in-memory repository doubles and `Layer.mock` only for non-repository ports. Cases follow the port contract (CM-PORT) and the Ports section of the domain rule file in the `project-business` skill; do not duplicate those cases here.
- Cover URL uniqueness in the repository contract suite: concurrent creates of the same URL in one scope leave exactly one row and the others are skipped, not overwritten. The rules are CM-PORT in the `project-business` skill's `common.md`.
- Do not assert exact id values; assert uniqueness and order. Ids come from the entity constructor default `Model.UuidV7WithGenerate` (CM-ID).
- When backend tests initialize `mem://`, call the SurrealDB adapter's `createSchema` directly and initialize the reader-store schema when exercising library persistence; do not rely on production migration side effects in tests.
- For library response regressions, exercise the real HTTP handler and decode its JSON through the `@reader/api` contract (`HttpApiClient.decodeResponse`). Include absent optional fields from stored rows; calling the use case alone does not verify HTTP encoding. Cover the public status, error `_tag` and any retained entity `id` or `url` through HTTP. Choose fixtures that actually reach the failing dependency: feed HTML parsing and sanitization require article content; test omission with a record that has no optional content.
- Owner isolation (CM-OWN) is covered once, in the repository contract suites: foreign or unknown ids read as absent and change nothing.
- For unread counts, cover that the feed counts and the saved-page count are served by their two separate endpoints. For the refresh queue, cover per-feed deduplication and that one failing feed is logged without stopping the rest (FD-SCHED).
- Frontend test scripts should not use `--passWithNoTests`; a missing web test suite should fail visibly rather than silently pass.
- Test browser-independent frontend state and validation logic in the existing Node/Vitest environment. Add a DOM environment only when the behavior under test depends on rendered DOM interactions.
- Keep the web Vitest `solid-js` alias in `apps/web/vite.config.ts` an exact-match regex (`/^solid-js$/`); a string key also rewrites `solid-js/store` and `solid-js/web` and breaks Better Auth's Solid client in tests.
- Paging tests go through the repository contract suite and page with ids as cursors; the cases follow CM-PAGE.
