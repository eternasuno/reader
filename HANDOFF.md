# Handoff

State at the time of writing: full verification passed on the committed tree
(`gofmt`, `go build`, `go vet`, `go test -race ./...`, `golangci-lint` 0 issues,
`pnpm --dir web check`, `pnpm --dir web test` 431 tests, `pnpm --dir web build`).
The final follow-up review found the open items below. They were intentionally
**not fixed** in this change; each is independent.

## Open findings (from the final independent review)

### High
1. **Shutdown can exceed its bounds** (`cmd/reader/main.go` ~319-360, `internal/http/server.go` ~127-175).
   - After the HTTP drain times out and `Server.Close` runs, `trackedHandler.active.Wait()` still waits unconditionally for a handler that does not return, so extraction cancellation and worker shutdown may never start.
   - `WaitExtractions` returns after its grace period but its helper goroutine stays blocked if an extraction never finishes.
   - Fix direction: make the handler drain deadline-aware; close the shared `drained` channel when the last in-flight call completes (under the mutex) instead of via a separate goroutine blocked on `WaitGroup`.

### Medium
2. **Kindle terminal-write budget exhaustion blocks sends until restart** (`internal/worker/kindle.go` ~175, ~411; `internal/sqlite/kindle_send_repo.go` ~130). After the 5 minute budget the in-process slot is released, but the DB row is still `running`; manual claims reject it and scheduled claims skip it. Retain ownership of the pending terminal update and reconcile it with bounded attempts while the app runs.
3. **URL decoder can reject valid server data** (`web/src/api/decoders.ts` ~37, `web/src/api/feeds.ts` ~113). Go accepts scoped IPv6 HTTP URLs; JavaScript `new URL()` rejects them, and the guard runs per item so one such URL discards the whole decoded list. Validate against the server's accepted format and handle browser navigability where the link is rendered.
4. **Dialog focus can return to the wrong element** (`web/src/ui/menu-focus.ts` ~15, `web/src/ui/Dialog.tsx` ~95). Every enabled menu action records its trigger in a module-global slot, including actions that open no dialog, so a later unrelated dialog can consume a stale trigger; a connected-but-hidden/disabled trigger also prevents the main-landmark fallback. Pass the opener explicitly with the specific open action and fall back when focusing fails.

### Low
5. **Kindle record decoder is looser than its type** (`web/src/api/decoders.ts` ~268). `articleCount`/`bookCount` are optional for `running`/`failed` sends although Go always emits them and the TS type requires them; `Date.parse` accepts non-RFC3339 formats.

## Known limitations, deliberately not changed

- **Login limiter** keys on `RemoteAddr` and ignores `X-Forwarded-For`. Behind a reverse proxy all users share one bucket. A trusted-proxy config option is a product decision.
- **CDP browser endpoint**: WebSocket dial target and `hostLookupFunc` IP selection are not restricted to the configured endpoint's network (the endpoint is admin-configured and may be private by design). Discovery redirects are restricted to the original origin and drop `Referer`.
- **HTTP shutdown** handler wait has no upper bound (pre-existing; see item 1).
- **Port normalization**: zero-padded ports (`:0443`) are now canonicalized when parsing, but already-stored rows keep the old text, so re-submitting such a URL can create a duplicate. A repeatable backfill migration with collision handling would fix it; migrations re-run on every startup and must stay idempotent.
- **CDP timeouts**: discovery and navigation each get a full webpage timeout (about 2x in the worst case).
- **External webpage iframe** keeps `allow-scripts allow-same-origin` per spec `RD-WEBPAGE-1`. External pages are cross-origin, and the SPA sends `frame-ancestors 'none'`, so the risk is limited to a framed page redirecting to Lantern itself. Removing `allow-same-origin` needs a spec change.
- Future dates render as "N分钟后"-style text rather than "刚刚".
- `captureBrowserSnapshot` / `createSnapshotWorld` have no unit coverage (need a real browser).
- Solid `UNCOMMITTED_INPUT_OVERWRITTEN` dev warnings in `web/test/settings-page-routes.test.tsx` come from mounting several apps in one test (shared radio `name`); the component itself commits synchronously.
- The fetcher test files were rebuilt after an accidental overwrite of the uncommitted original; coverage was reconstructed from the older committed tests plus the new behavior (83.3% statement coverage), so a few original cases may be missing.

## Not verified in a browser

- Light theme inside the article iframe.
- No trailing blank space below short articles.
- Only one settings panel visible at a time (visibility is CSS-only).
- Focus return after menu-opened dialogs and the lightbox.

## Spec drift left undecided

- Feed menu order, scope order (全部订阅 vs 稍后阅读), site icon in single-feed scope.
- "嵌入式" vs "内嵌" naming.
- `feeds.md` vs `library.md` disagree on where OPML import/export lives.

## Housekeeping

- Old `leaf-*` service-worker caches are intentionally preserved; cleaning them is a separate decision.
- Test-suite cleanup consolidated tests into tables and shared harnesses (`web/test/support/app-harness.ts`, Go `*_helpers_test.go`); no security/a11y cases were intentionally dropped.
