---
name: project-effect-api
description: Follow the server API constraints when working on this repository's Better Auth paths, session identity, protected APIs, HTTP handlers and the library HTTP contract, error mapping, the feed refresh queue and scheduler, adapters, Effect Services, or Layer composition.
---

# Effect API

Business rules (entities, use cases, ports, repository contracts) are in the `project-business` skill. This skill covers the server around them.

## Authentication and Identity

- Better Auth exclusively owns `/api/auth/*`; do not reimplement the Better Auth protocol in application routes. Use Effect HTTP routes for other business operations.
- Derive identity only from the Better Auth session cookie in the backend request; never accept or trust a user ID submitted by the client. A request naming another owner is still handled as the session's user.
- APIs requiring authentication must use `sessionMiddleware` and obtain identity from `Session`; every library endpoint rejects a request without a session with 401.
- Keep the Origin check (`apps/api/src/middleware/origin.ts`): a non-GET library request whose `Origin` differs from the auth base URL gets 403.

## Shared Effect Services

- For application- or system-scoped capabilities that must be shared across multiple Layers without explicit parameter threading, define a `Context.Service` and provide it from the root `Layer`.
- Use the `Live` suffix for effective runtime Layers (for example, `AuthLive`). Construct the Effect only once in the Service Layer; consumers obtain the capability with `yield* Service`.
- A Service is a shared dependency within the current Effect scope, not a permanently global process singleton; include root Layer composition in the application runtime.
- Abstract a Service or Layer only for meaningful, reusable capability boundaries; avoid one-off `make*` wrappers, duplicate service types, and unnecessary Layers.
- Keep route composition separate from runtime dependency provision in `server.ts`. Merge independent dependencies into one named Layer; retain provider nesting for real dependencies such as AuthLive requiring DatabaseLive, not for one-use category groups.
- Prefer framework-provided route Layers over manually constructing equivalent handlers.
- After composing multiple dependency Layers, call `Effect.provide` only once on the target Effect.
- The app provides Effect's plain `FetchHttpClient.layer` as the `HttpClient` business uses for feeds. Add no transport policy (address checks, redirect handling, size caps, timeouts) without a requirement.

## HTTP boundary

The endpoint contract lives in `packages/api`; handlers live in `apps/api/src/routes`.

- Decode request input into the business types once in the handler (`routes/library-input.ts`): a page URL into `NormalizedUrl` (failure `InvalidPageUrl`), a feed URL into `NormalizedUrl` (`FeedUrlInvalid`), the subscribe title with `makeFeedTitle(title ?? '', url)` so a blank title becomes the host, the retention into `Retention` (`InvalidRetention`, a positive integer), the fetcher provider into `jina` or `browser` (`InvalidProvider`), a given browser endpoint into `BrowserEndpoint` (`InvalidEndpoint`: http, https, ws or wss).
- For the fetcher input, an omitted, empty or blank key or endpoint counts as not given, so the stored value is kept (SET-VAL-6). The browser provider with no endpoint given or stored fails `BrowserEndpointRequired`.
- `GET /settings` returns only `retention`, `provider`, `jinaKeyConfigured` and `browserEndpointConfigured`. Never put the Jina key or the browser endpoint in a response, error message or log.
- For extraction (add a saved page, save a feed item, extract a feed item) read the owner's setting first and provide `BrowserWebpageFetcherLive(endpoint)` when the provider is `browser` and an endpoint is stored, else `JinaWebpageFetcherLive(key)`. Layer factories never query the database.
- Subscribe enqueues the new feed in `FeedRefreshQueue` after `subscribeFeed` succeeds and returns 201 at once; no user operation refreshes a feed from its source.
- Lists take `limit` (a positive integer, no maximum), `unreadOnly` and an optional `cursor` (the row id); the feed counts and the saved-page count are two separate endpoints.
- Map business errors to failures with the same `_tag` and a Chinese user message (`routes/library-errors.ts`, `library-failures.ts`): input decoding failures 400; `FeedItemNotFound` and `FolderNotFound` 404 with `id`; `FeedAlreadyExists` and `SavedPageAlreadyExists` 409 with the normalized `url`; fetch, parse and extraction failures and `BrowserEndpointRequired` 422 (`HtmlParserError` maps to `ArticleExtractorError`); repository errors 500 with their own tags. The webpage-fetch failure message stays generic: `网页抓取失败，请稍后重试`. Keep the web client's tag whitelist (`apps/web/src/lib/library-error.ts`) in step with these tags.
- A request that fails schema decoding (malformed `limit` or `cursor`, missing payload field) gets 400 with an empty body; only handler failures carry `{ _tag, message }`.

## Adapters

- Keep adapter failures in typed Effect errors with a message.
- The feed parser reads RSS, Atom, RDF and JSON Feed. It escapes plain-text Atom fields and JSON `content_text` once, resolves entry URLs against the final URL of the fetch, drops entries without a valid URL, reports a missing publish time as none, and turns an empty feed title into the host.
- The article extractor reports a missing publish time as none and returns sanitized content. The sanitizer uses DOMPurify's defaults, resolves relative `href` and `src` against the article URL, and sets `target="_blank"` on links so they leave the sandboxed reader frame.

## Feed refresh queue and scheduler

- The queue and scheduler live in `apps/api/src/infrastructure`, not in the packages (FD-SCHED). `FeedRefreshQueue.enqueue(owner, feedId)` drops a request for a feed that already has a refresh running, otherwise runs business `refreshFeed(owner, feedId)` in the queue's scope. Refreshes of different feeds run at the same time without a bound; a failure or defect is logged with owner and feed id and never stops the others.
- The scheduler lists every feed with its own query at start and every 30 minutes and enqueues each; a listing failure is logged and retried at the next interval.

## API Details

When current API routes, startup procedure, or Better Auth configuration details need confirmation, first read the relevant section of `README.md`; do not duplicate volatile lists or defaults in this skill.
