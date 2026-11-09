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

- Use entities as shared data types across ports and use cases. Reuse their schemas and fields; do not introduce repository-value or input variants merely to omit fields or rename the same data. Derive writable patches from entity fields when partial updates require different omission semantics.
- Decode, normalize, and validate external input once with Effect Schema at user-input, network, or database boundaries. Use brands for established normalized formats; do not decode or normalize these values again in use cases. Retain context-dependent business checks such as ownership, cursor scope, missing records, and duplicates.
- Define effectful use cases as ordinary functions returning `Effect.gen`, rather than `Effect.fn`. Propagate port errors unchanged; map them to public HTTP errors in route handlers.
- Return domain entities and meaningful business results from use cases. Build HTTP wrappers such as `{ item }` and `{ ok: true }` at the API boundary; avoid manual entity projections and patch conversion chains.
- Do not add a repository read after a successful write solely to construct a return value. Use the known entity and patch, or an entity returned by the mutation when that is its existing contract.
- Keep value objects in `entity/object-value`, one file each; entities live next to their aggregate (`entity/feed`, `entity/saved-page`) and settings groups in `entity/setting`. Ports carry only external capabilities; ID derivation, cursor codecs, `ReadFilter` and other policies live in `usecase`. `ExtractedArticle` is the extractor port's own result, consumed by both feed items and saved pages, so `port/article-extractor.ts` defines it from `entity/object-value` value objects instead of deriving it from `FeedItem` or `SavedPage`; its `content` stays an `Option` so empty pages still raise `ArticleEmptyContent`.

## Reader Repository Contracts

- `FeedItem` belongs to a `Feed` and carries no owner. `FeedItemRepository` is keyed by feed ids only; use cases resolve ownership first with `FeedRepository.find(owner, feedId)` or `list(owner)` and then pass feed ids. Never call it with ids the owner has not been checked against. `SavedPage` is an owner-scoped root: `SavedPageRepository` takes an explicit owner, its content is required, and its URL is optional.
- Selecting feeds is a plain `ReadonlyArray<FeedId>`; an empty array returns no rows or performs no update. Empty id selections also perform no update.
- List queries take a plain `read?: boolean` (absent means all); ports never import `ReadFilter`, and `usecase/pagination.ts` maps it with `readStateOf`. Paging is two operations: `list(…, { read?, after?, limit })` returns one keyset page, and `listThrough(…, { read?, through })` returns the inclusive prefix up to a boundary without `limit`, which refresh uses as a single query. List endpoints accept `cursor` only and refresh endpoints take `through`; do not merge them back into one query type with optional `after` and `through`.
- List order is `publishedAt` then id, both descending. The store `ORDER`, the retention tie-break in `usecase/feed-selection.ts` (the lowest id among tied existing articles is evicted first, matching what is displayed last) and `compareArticles` in `apps/web/src/pages/library-refresh.ts` must agree; change them together.
- Derive `FeedItemPatch`, `SavedPagePatch`, `FeedPatch`, and `SettingsPatch` from entity fields with `Schema.optionalKey`; omit identity and ownership fields. Omitted fields preserve values, `Option.none()` clears optional values, and `Option.some(value)` sets them. Name mutation parameters `patch` or `feedPatch`.
- Settings are grouped (`feed`, `fetcher`) and the fetcher keeps `jina` and `browser` configuration side by side with a `provider` selector. `SettingsRepository` exposes `get` and `update`; patches are applied per field. Validate that the browser provider has an endpoint in `updateSettings`, not in the repository. Derive `jinaConfigured` in the HTTP handler and omit the secret from public responses. Empty patches must not create rows.
- Unread counts return `{ saved, feedsTotal, feeds }` from the `unreadCounts` use case, which lists the owner's feeds once and groups feed items by feed id.
- Discover subscription schedule owners through separate infrastructure, then list and refresh subscriptions within each owner. Keep timers and queue deduplication scoped; prevent overlapping work for one owner and isolate individual feed failures. Do not add refresh-frequency settings without a product requirement.
- Keep adapter failures in typed Effect errors with a message. The webpage-fetch failure shown to the user remains generic: `网页抓取失败，请稍后重试`.

## API Details

When current API routes, startup procedure, or Better Auth configuration details need confirmation, first read the relevant section of `README.md`; do not duplicate volatile lists or defaults in this skill.
