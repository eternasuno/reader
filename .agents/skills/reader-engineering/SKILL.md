---
name: reader-engineering
description: How the 留白 reader is built. Read before writing, moving or reviewing code, adding a dependency, a package, a directory or an import, composing Effect Layers, wiring HTTP handlers, the refresh queue or the web client's state, or writing tests. Holds the technology choices and their reasons, the packages and their dependency direction, the internal layout of apps/reader, and the testing strategy; database, UI styling and deployment are in conditional files.
---

# Reader engineering

What the product does is in the `reader-spec` skill; this skill says how the code is organized. Effect 4 coding rules (read the installed source, `Effect.fn`, one Promise/Effect crossing) are in `AGENTS.md`.

Conditional files:

- Read [database.md](database.md) when touching SQLite: connections, schema, migrations, queries, indexes, repository implementations.
- Read [ui.md](ui.md) when touching styling, layout, shared controls, focus handling, icons or the article iframe.
- Read [deployment.md](deployment.md) when touching builds, Docker, environment variables, static serving or the data directory.

## Technology choices

Changing one of these needs a reason stated to the user first.

| Concern | Choice | Why |
| --- | --- | --- |
| Language and runtime | TypeScript 7 (strictest flags), Node 24 (engines `>=22.19`) | built-in `node:sqlite`, no native modules |
| Workspace | pnpm workspace + Turborepo, version catalog for shared versions | one lockfile, cached `build`/`typecheck`/`test` |
| Lint and format | Biome | one tool; import boundaries via `noRestrictedImports` overrides; 300 non-blank lines per file |
| Server and shared logic | Effect 4 (`effect`, `effect/http`, `effect/http-api`, `effect/schema`, `effect/sql`) | typed errors, Layers for dependency injection, one HTTP contract shared by server and client |
| HTTP server | Effect `HttpApi` on `@effect/platform-node` | the contract types both the handlers and the browser client |
| Auth | Better Auth, email and password | owns the auth protocol and its storage; the app never reimplements it |
| Storage | SQLite through `node:sqlite`, `@effect/sql-sqlite-node` for the reader data | embedded, one file per database, no service to run |
| Feed parsing | `feedsmith` | RSS, Atom, RDF and JSON Feed in one parser |
| HTML parsing, extraction, sanitizing | `jsdom`, `@mozilla/readability`, `dompurify` | standard DOM on the server; Readability for the article; DOMPurify for safe HTML |
| Page fetching | Jina reader API over Effect `HttpClient`; `puppeteer-core` over a `ws` CDP transport for a user-run browser | no bundled browser |
| Web UI | SolidJS 1 SPA, `@solidjs/router`, `@tanstack/solid-virtual` | fine-grained reactivity, small bundle; client rendering only |
| Styling | Tailwind CSS 4 + daisyUI 5 | utilities and theme tokens only, no component CSS |
| Tests | Vitest with `@effect/vitest` | one runner for every package |
| Build | Vite 8: the SPA build and the server SSR build | one tool for both bundles |

## Packages

Each package has one job. Adapters are separate packages so that each brings only its own dependencies.

| Package | Job | Depends on |
| --- | --- | --- |
| `packages/business` (`@reader/business`) | entities, ports, use cases; `./testing` exports the in-memory doubles and the contract suites | `effect` only |
| `packages/sqlite` (`@reader/sqlite`) | reader SQLite connection (`reader.db`), reader migrations, the repository adapters, the cross-owner feed listing for the scheduler; `./testing` exports in-memory database Layers | `@reader/business`, `effect`, `@effect/sql-sqlite-node`, `node:` modules |
| `packages/content` (`@reader/content`) | `FeedParser` (feedsmith), `HtmlParser` (jsdom), `ArticleExtractor` (Readability + DOMPurify), `DocumentSanitizer` (DOMPurify) | `@reader/business`, `effect`, those libraries |
| `packages/webpage` (`@reader/webpage`) | `WebpageFetcher` Layers for Jina and for a browser service | `@reader/business`, `effect`, `puppeteer-core`, `ws` |
| `apps/reader` | the product: HTTP contract, server, web client | everything above |

Dependency direction, enforced by `biome.json`:

```text
apps/reader/src/server ──> contract, @reader/sqlite, @reader/content, @reader/webpage, @reader/business
apps/reader/src/web    ──> contract
apps/reader/src/contract ──> @reader/business (entity and value schemas)
@reader/sqlite, @reader/content, @reader/webpage ──> @reader/business
@reader/business ──> effect
```

- No package imports `apps/reader`. Adapter packages do not import each other.
- `src/web` imports nothing from `src/server`, from the adapter packages, from `node:` modules or from Better Auth's server entry (`better-auth/solid` is the client), and only `src/web/api` imports `effect`. Entity types reach the web through `src/contract`.
- `src/` never imports `test/` or a `*/testing` entry.
- Inside a package, modules import each other by relative path; across packages only through the package name.

## apps/reader

`src/contract` defines the shared `HttpApi` (one group per domain, the contract errors, and the `Authentication` and `OriginCheck` middleware declarations) so `src/server` and `src/web` share one wire contract without sharing runtime code.

Two tsconfig files, both extending the root `tsconfig.json` (which keeps the shared strict flags and the Effect language-service settings): `tsconfig.server.json` (Node types; `src/server`, `src/contract`, `test/server`) and `tsconfig.web.json` (DOM types, JSX; `src/web`, `src/contract`, `test/web`). `pnpm typecheck` runs both.

### Server

- **Composition.** `main` builds every dependency Layer once and provides it once: the reader database and repositories from `@reader/sqlite`, the content adapters, `FetchHttpClient.layer`, the Better Auth instance over the auth database, the refresh queue and the scheduler. Route composition is separate from dependency provision, and dependencies are provided outside `HttpRouter.serve` so one reader connection and one queue serve the routes, the refreshes and the scheduler. Effective Layers carry the `Live` suffix. No one-off `make*` wrappers or Layers for one-use groupings; nest providers only for real dependencies.
- **Auth.** Better Auth alone serves `/api/auth/*` through one wildcard route that converts the request to a Web `Request` and the answer back. Identity comes only from the session cookie (`getSession`); the `Authentication` middleware provides `Session` and forwards the headers Better Auth returns (renewed or cleared cookies) through a pre-response handler, so they reach error responses too. `OriginCheck` is attached to every state-changing endpoint.
- **Handlers.** One module per domain in `http/` implements its contract group. A handler decodes input into business types once (`reader-spec` says which error each failed decoding returns), calls one use case or one port method, and maps business errors to contract errors through one table from business `_tag` to contract error. Handlers reach repositories, adapters and the queue only through business ports and the `FeedRefreshQueue` service. The only implementation a handler chooses is the `WebpageFetcher` (`http/fetcher.ts`, the only module in `http/` that imports `@reader/webpage`): inside the fetch it reads the owner's setting, asks `activeFetcher` and maps the result exhaustively to `JinaWebpageFetcherLive(key)` or `BrowserWebpageFetcherLive(endpoint)` for that request. Layer factories never query the database.
- **Errors.** Contract errors are `Schema.TaggedError` classes whose status is an annotation; nothing writes `_tag` by hand. The business-to-contract table maps `HtmlParserError` to `ArticleExtractorError` (CM-FETCH-4). The `Authentication` middleware fails with the empty-body 401 `Unauthorized` when there is no session and with 500 `AuthUnavailable` when Better Auth's session check itself fails; `OriginCheck` fails with the empty-body 403 `Forbidden`. These two empty bodies are the only failures without a `_tag`. The server holds no user-facing text.
- **Refresh.** `FeedRefreshQueue.enqueue(owner, feedId)` drops a request for a feed whose refresh is running, otherwise forks `refreshFeed` in the queue's scope; refreshes of different feeds run concurrently without a bound; a failure or defect is logged with owner and feed id and never stops the others. The scheduler enqueues every feed (through the cross-owner listing of `@reader/sqlite`) at start and every 30 minutes; a listing failure is logged and retried at the next tick. Both stop with the server scope.
- **Adapters.** Adapter failures are typed errors with a message safe to log; secrets (Jina key, browser endpoint) are `Redacted` and never logged.

### Web

The URL is the source of truth for what is shown: the scope, the open article and the unread filter come from the route (`reader-spec` Routes). Every protected route sits under one `SessionGuard` (`account/session-guard.tsx`), and the library paths sit under one `LibraryPage` shell (`library/`) so switching scope or article only changes route parameters without remounting the shell. State lives in feature modules (`library/`, `saved-page/`, `feed/`, `folder/`, `setting/`, `reader/`, `account/`), each owning its own state and exposing actions; components render state and call actions.

- **Stores.** One store or signal group per concept, owned by one module: the feed list and feed unread counts (`feed/`), the folder list and collapsed state (`folder/`), the saved-page unread count (`saved-page/`), the article list of the current scope (`library/`), the open article and its mode (`reader/`), toasts (`ui/`), settings state and drafts (`setting/`). A module that needs another's data calls its exported accessor or action; no two modules write the same store. When a file outgrows the cap, split by concept, never into `mutations`/`read`/`loading` files sharing one store (`AGENTS.md`).
- **Requests.** `api/` is the only module in `src/web` that imports `effect`, and it imports no Solid API, router or other `src/web` module (`biome.json`). It exposes Promise-returning functions and plain wire types: the Effect `HttpApiClient` runs once inside `api/` and encodes decoded responses back to their wire JSON form (`Schema.encodeEffect` over `Schema.toCodecJson`). It also owns the one table from contract error tag to Chinese wording (`api/messages.ts`) and the Better Auth operation-and-code error wording (`api/auth.ts`). Stores and components await those functions; they do not touch Effect, and every request goes through the derived client: no hand-written path, method or response schema.
- **Quick actions.** Follow `reader-spec` Client conventions: quick actions are never disabled and the stores keep no per-row pending tokens, in-flight sets or counters to decide what may be clicked; forms keep their validation, and a submit shows a spinner and is disabled while its request runs.
- **Components.** `ui/` components carry no domain: `ui/` may not import `api/`, `routes` or any feature module (`biome.json`), and receives data through props (`ui.md`). Feature components may use their own module's store and other modules' exported accessors. Components own presentation, native form validation, conversion of form data to action parameters, and navigation; business decisions live in stores and actions.
- **Session.** One Better Auth Solid client (`createAuthClient` from `better-auth/solid` in `api/auth.ts`); `useSession()` is called inside a component's owned scope and its accessor read directly; no separate signal bridge. While Better Auth reads the session again (after sign-out, on focus, after a 401) it keeps the previous user with `isRefetching`, and the read starts a microtask after `signOut()` resolves. So redirect decisions use `isConfirmedSignedIn` (`api/auth.ts`), and nothing navigates to `/login` itself after sign-out or a 401: the 401 handler only calls `refetch()` and `SessionGuard` redirects when the answer is "no session". Navigating earlier makes `/login` bounce back to a guarded page, and in Firefox the repeated `replaceState` freezes the tab.
- **Rendering.** Client rendering only; no SSR, no server functions. Article HTML is shown only inside the sandboxed iframe (`ui.md`).

## Biome boundaries

`biome.json` enforces the dependency direction above with `noRestrictedImports` overrides; each message names this skill. When a new directory is a new layer, add its override in the same change. Never silence a boundary with `biome-ignore`; change the boundary and this skill together when the design needs it.

## Testing

Tests verify behavior the project owns, name the rule (`SP-ADD-1`) or scenario (`Scenario: Creating a folder`) they cover, and test each rule once, at the layer that owns it; a layer above tests only what it adds. Before deleting a test as a duplicate, find the kept test of the same rule at the owning layer.

| Layer | Where | Tests only |
| --- | --- | --- |
| Entity | `packages/business/test/entity/` | value rules: trimming, URL normalization, defaults |
| Port contract | `packages/business/test/support/contract/` (suites), run by `packages/business/test/port/` against the doubles and by `packages/sqlite/test/` against SQLite | repository behavior: filtering, order, uniqueness, ownership, atomicity, paging |
| Use case | `packages/business/test/usecase/` | orchestration: which ports are called, how errors are told apart; in-memory doubles for repositories, `Layer.mock` for other ports |
| Adapter | `packages/content/test/`, `packages/webpage/test/` | the adapter's contract (FD-PARSE for the feed parser, sanitizing, fetch requests and error mapping) |
| HTTP | `apps/reader/test/server/` | session and origin checks, input decoding, error-to-status mapping, responses that hide secrets, one wired-through case per endpoint, decoded through the contract |
| Web | `apps/reader/test/web/` | stores and actions: response-to-state conversion, the acceptance scenarios of `reader-spec` that are observable in state |

- All test code lives in each package's `test/`, mirroring `src/`; helpers (doubles, suites, fixtures, network stubs, database setup) live under `test/support/`. Test files follow the 300-line cap: a suite that outgrows it becomes a directory.
- Prefer real Layers; use `Layer.mock` when a substitute is needed. Do not test third-party library behavior.
- Backend tests open a fresh `:memory:` database per test through `@reader/sqlite/testing`; auth tests use an in-memory database with Better Auth's migrations. No test relies on `db:migrate`.
- Do not assert exact id values; assert uniqueness and order (CM-ID-5).
- Web tests run in Node without a DOM; add a DOM environment only for behavior that depends on rendered DOM. Keep the Vitest `solid-js` alias an exact-match regex (`/^solid-js$/`): a string key also rewrites `solid-js/store` and `solid-js/web` and breaks Better Auth's Solid client.
- Test scripts never use `--passWithNoTests`.
- Acceptance scenarios that need a real browser (layout, focus, iframe) are verified by hand in a browser before a change is called done; say so in the summary.
