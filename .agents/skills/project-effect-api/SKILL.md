---
name: project-effect-api
description: Follow the server API constraints when working on this repository's Better Auth paths, session identity, protected APIs, Effect Services, or Layer composition.
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

## Reader Repository Contracts

- User repository operations require an explicit owner; FeedRepository has no ownerless listing. Batch feed creation takes ownership from that argument, and feed updates patch only permitted fields.
- Keep `listLater` / `updateLater` separate from `listFeeds` / `updateFeeds`. Feed selection is `Option<readonly FeedId[]>`: `None` selects all subscribed articles, `Some(ids)` selects those feeds, and `Some([])` returns no rows or performs no update. All feed scopes exclude later reading. Empty article-ID selections also perform no update.
- Derive `ArticlePatch`, `FeedPatch`, and `SettingsPatch` from entity fields with `Schema.optionalKey`; omit identity and ownership fields. Omitted fields preserve values, `Option.none()` clears optional values, and `Option.some(value)` sets them. Name mutation parameters `articlePatch`, `feedPatch`, or `settingsPatch`.
- SettingsRepository exposes `get` and `update`; keep secret keys redacted in the repository result and derive public configuration flags in the use case. Empty patches must not create rows.
- Unread counts use one owner-scoped grouped query and one browser request, returning later, subscription total, and per-feed counts together. Preserve the existing cursor pagination; `inventory` is the lightweight per-feed refresh inventory, not a full-list pagination step.
- Discover subscription schedule owners through separate infrastructure, then list and refresh subscriptions within each owner. Keep timers and queue deduplication scoped; prevent overlapping work for one owner and isolate individual feed failures. Do not add refresh-frequency settings without a product requirement.
- Keep adapter failures in typed Effect errors with a message. The webpage-fetch failure shown to the user remains generic: `网页抓取失败，请稍后重试`.

## API Details

When current API routes, startup procedure, or Better Auth configuration details need confirmation, first read the relevant section of `README.md`; do not duplicate volatile lists or defaults in this skill.
