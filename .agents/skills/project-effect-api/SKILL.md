---
name: project-effect-api
description: Follow the server API constraints when working on this repository's Better Auth paths, session identity, protected APIs, business ports and use cases, repository and paging contracts, Effect Services, or Layer composition.
---

# Effect API

## Authentication and Identity

- Better Auth exclusively owns `/api/auth/*`; do not reimplement the Better Auth protocol in application routes. Use Effect HTTP routes for other business operations.
- Derive identity only from the Better Auth session cookie in the backend request; never accept or trust a user ID submitted by the client.
- APIs requiring authentication must use `sessionMiddleware` and obtain identity from `Session`; do not pass identity as a business parameter instead of validating the session.

## Shared Effect Services

- For application- or system-scoped capabilities that must be shared across multiple Layers without explicit parameter threading, define a `Context.Service` and provide it from the root `Layer`.
- Use the `Live` suffix for effective runtime Layers (for example, `AuthLive`). Construct the Effect only once in the Service Layer; consumers obtain the capability with `yield* Service`.
- A Service is a shared dependency within the current Effect scope, not a permanently global process singleton; include root Layer composition in the application runtime.
- Abstract a Service or Layer only for meaningful, reusable capability boundaries; avoid one-off `make*` wrappers, duplicate service types, and unnecessary Layers.
- Keep route composition separate from runtime dependency provision in `server.ts`. Merge independent dependencies into one named Layer; retain provider nesting for real dependencies such as AuthLive requiring DatabaseLive, not for one-use category groups.
- Prefer framework-provided route Layers over manually constructing equivalent handlers.
- After composing multiple dependency Layers, call `Effect.provide` only once on the target Effect.

## Business Data and Use Cases

Business contracts and layout below describe the rewrite target in `docs/`, not the current implementation. Before changing existing code, read `docs/README.md` (especially "The current code") and the relevant `docs/usecases` spec.

- Use entities as shared data types across ports and use cases. Reuse their schemas and fields; do not introduce repository-value or input variants merely to omit fields or rename the same data. Derive writable patches from entity fields when partial updates require different omission semantics.
- Ids are lower-case version-7 UUIDs: each id brand checks `Schema.isUUID(7)` and `Schema.isLowercased()`, and the entity's `id` field takes `Model.UuidV7WithGenerate` (`effect/schema`) as its constructor default. Use cases build new rows with the entity's `makeEffect`, inside their own fiber so the default reads the injected `Clock`, leave `id` out, and treat a construction failure as a defect (`Effect.orDie`); there is no id port (`docs/usecases/common.md` CM-ID). Use cases never compute an id from content and never call `Date.now()`; "now" is only the injected `Clock` (CM-TIME), and ids are not times.
- Decode, normalize, and validate external input once with Effect Schema at user-input, network, or database boundaries. Use brands for established normalized formats; do not decode or normalize these values again in use cases. Retain context-dependent business checks such as ownership, missing records, and duplicates; do not validate a paging cursor against the scope or filter it is used with (CM-PAGE).
- Define effectful use cases as ordinary functions returning `Effect.gen`, rather than `Effect.fn`. Propagate port errors unchanged; map them to public HTTP errors in route handlers.
- Return domain entities and meaningful business results from use cases. Build HTTP wrappers such as `{ item }` and `{ ok: true }` at the API boundary; avoid manual entity projections and patch conversion chains.
- Do not add a repository read after a successful write solely to construct a return value. Use the known entity and patch, or an entity returned by the mutation when that is its existing contract.
- Group business code by domain as in `docs/README.md` "Target code layout": `common/`, `feed/`, `saved-page/`, `setting/`, each with `entity/`, `port/`, `usecase/` and `index.ts`. Value types live in the `entity/` of their domain; article values shared by feed items and saved pages live in `common/entity`. Ports carry only external capabilities; the position cursor and other helpers live in `usecase/`. Import another domain only through its `index.ts`, following `SavedPage -> Feed -> Setting -> Common`.

## Business Contracts

- Port-owned output schemas stay with their ports. `ExtractedArticle` is the `ArticleExtractor` port's own result, composed from the `common/entity` article values (title, description, content, publish time), not derived from a stored `FeedItem` or `SavedPage`; its fields follow `docs/usecases/common.md` CM-FETCH.
- The repository and paging contracts live in `docs/`, not here. When changing a repository, a list query or a cursor, read `docs/usecases/common.md` CM-OWN, CM-PAGE and CM-PORT, plus the Ports section of the domain spec (`docs/usecases/feed.md`, `docs/usecases/saved-page.md`, `docs/usecases/setting.md`).
- Derive patches such as `FeedItemPatch` and `SettingsPatch` from the entity fields a caller may write with `Schema.optionalKey`; a missing field means no change, `Option.none()` clears an optional value and `Option.some(value)` sets it. Immutable fields are never in a patch (CM-PORT-4). Name mutation parameters `patch` or `feedPatch`.
- When changing settings, read `docs/usecases/setting.md` SET-FETCH and its `SettingRepository` port.
- When changing the scheduler, read `docs/usecases/feed.md` FD-SCHED and FD-SUB. Keep the refresh queue and its configuration outside the packages.
- The feed unread counts and the saved-page unread count (`unreadCounts`, `unreadCount`) are direct port calls (FD-COUNT, SP-COUNT) served by two separate endpoints; do not aggregate them into one response.
- Keep adapter failures in typed Effect errors with a message. The webpage-fetch failure shown to the user remains generic: `网页抓取失败，请稍后重试`.

## API Details

When current API routes, startup procedure, or Better Auth configuration details need confirmation, first read the relevant section of `README.md`; do not duplicate volatile lists or defaults in this skill.
