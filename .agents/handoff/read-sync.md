# Handoff: read/unread sync rework + bounded mark-all

Branch: `refactor/ui-and-fine-grained-state`. Status at handoff: plan revision 4 settled with the user; implementation NOT started. The committed frontend read-sync code is a prototype with known defects (see "Prototype state").

## Already done on this branch (committed)
- Solid 2.0.3 / Go dependency upgrades; upstream Solid issue noted in `.agents/skills/reader-engineering/upstream-issues.md`.
- Feed icons (`feed.icon_url`, `iconUrl`), keyboard shortcuts removed, UI polish.
- Goose migrations (`github.com/pressly/goose/v3` v3.30.1): `internal/sqlite/migrations.go` (non-global provider, Go migration v2 adds `feed.icon_url` if missing), `001_init.sql` restored to the deployed schema + `-- +goose Up`. Independently reviewed (no blockers); tests cover deployed/branch/fresh DBs, idempotent reopen, full version history, Open failure rollback. Next migration number is 3.
- Fine-grained store, keyed `VirtualList` rows (no fade-in replay), `ArticleRow` projection, `web/src/state/read-sync.ts` prototype. `noParameterAssign` removed from `web/biome.json`.
- All checks green at commit time: go vet/lint/test, `pnpm --dir web check|test|build` (59 files / 474 tests). Not browser-verified.

## Prototype state (defects found by code review, to be fixed by the plan below)
- Batch requests include IDs already owned by an in-flight request (`read-sync.ts` beginBatch, `library-actions-bulk.ts`).
- Optimistic scope mark-all tracks only displayed rows while the server updates the whole scope.
- Count GETs returning during a pending write double-count or leave stale counts (`read-sync.ts`, `sidebar.ts`).
- Failed mark-all clears counts and relies on a refetch.
- Feed-move rollback restores stale optimistic `read` values (`library-store.ts`).
- Minor: snapshot holds block fresh GETs during unrelated slow requests; failed mark-all can toast across logout; VirtualList tests don't check measurement-cache offsets after prepend/remove.

## Research summary (Miniflux, yarr, FreshRSS, CommaFeed, NewsBlur, TT-RSS)
None serialize read writes with mark-all or guard count fetches against in-flight writes; all rely on polling/reload and most have count-drift bug reports. Borrowed: explicit read/unread values (TT-RSS), changed-rows-only SQL (FreshRSS `is_read <> ?`; ours already `WHERE read = 0`), mark-all bounded by a server snapshot (FreshRSS `idMax`, CommaFeed `insertedBefore`), single-toggle optimistic + bulk pessimistic (CommaFeed).

## User decisions (final; do not re-litigate)
1. Keep exactly the two bulk actions (`将已加载文章标为已读`, `全部标记为已读`); no new modes/options/UI.
2. Single-row toggles, auto-read on open, and mark-loaded stay optimistic. `全部标记为已读` becomes pessimistic (wait for server, then reload).
3. Mark-all boundary = UUIDv7 `id` (CM-ID-1: lists sort by id, cursor is id; publishedAt display-only). No `created_at` column, no migration.
4. Sidebar mark-all on a scope whose list is not loaded uses the boundary of the last applied count response.
5. Folder membership is evaluated when read-all executes (existing SQL `feed_item_repo.go` folder read-all) — document only, no new mechanism.
6. Periodic sidebar refresh every 60 s (new behavior; spec update).

## Plan (revision 4)

### A. Read mutation queue (frontend)
1. One ordered queue per tab; requests carry explicit read=true/false.
2. Per row: `confirmed` (last server-known) and `display` (latest pending intent, else confirmed). Repeated changes to one article while its request is in flight coalesce into the next request; never two concurrent writes per article. Skip a write as no-op only if nothing is in flight for the row and intent == confirmed.
3. Mark-loaded: captures loaded unread IDs at click; one request; counts adjust by exactly those rows.
4. Failure (LIB-READ-1 kept): toast once per failed batch; failures superseded by a later choice are silent and change nothing. Non-2xx → roll back to `confirmed`. Ambiguous (timeout/network after send, `web/src/api/deadline.ts`) → treat as failure, then re-fetch affected visible rows and counts once after drain. Accepted limit: a commit later than that re-fetch stays wrong until next reload / next periodic refresh.
5. A fetched record sets `confirmed` only if its GET was dispatched after the row's last settled write (existing protection in `library-store.ts`); `display` keeps any pending intent. Feed-move rollback never restores `read`.

### B. Mark-all (pessimistic)
1. Click (heading `⋯` or sidebar `ScopeRow.tsx` menu) synchronously enqueues a barrier with the target scope. Earlier intents send first; later intents wait behind it; coalescing never crosses a barrier.
2. Boundary: accepted list page-one boundary of the current generation for that scope; else the boundary paired with the relevant count (feed map for feed/folder/all, saved-page count for /later). If none is known, the barrier itself fetches that count endpoint and uses its boundary directly (not subject to D2 idle acceptance; only badge publication is). Fetch failure → toast, barrier removed, no write.
3. No optimistic change; informational loading indicator near the heading / sidebar row; menu item never disabled; repeat click enqueues another barrier.
4. Success → intents enqueued before the barrier are retired; reload current list from page one (new generation; stale GETs dropped by existing generation check); refresh the open reader article via the generation-guarded detail fetch merged into the retained record (do not reopen the route, keep selection and reader mode, do not re-trigger auto-mark); later intents remain pending and are sent normally. A later failed toggle rolls back to `confirmed` (possibly mark-all's `true`).
5. Failure → toast only. Ambiguous → same reload as success.

### C. Boundary (backend + frontend)
1. Semantics: ID-allocation cutoff — mark-all marks unread items in scope with `id <= boundary`. Accepted limits: id allocated before boundary but committed after; server clock rollback.
2. Server mints `domain.NewID()` before the request's first data read and binds `id <= boundary` in its queries.
3. Lists (`/api/feeds/{id}/items`, `/api/folders/{id}/items`, `/api/feed-items`, `/api/saved-pages`; both orders; unread filter): every response `{ items, cursor, boundary }`; continuation must send cursor + boundary; cursor without boundary or invalid boundary → `400 RequestFailed`. Single-item GETs unbounded. Limit 1..200, stored single-feed order, CSRF unchanged.
4. Counts: `GET /api/feeds/unread-counts` keeps its `items` key and adds `boundary`; `GET /api/saved-pages/unread-count` returns `{ count, boundary }`; both bind `id <= boundary`. Client stores each accepted count with its boundary; keeps previous pair on failure. Folder/all badges = sums over current client feed metadata.
5. Filter/order changes reset list boundary with the cursor; replacement installed only after the generation check.
6. All 4 read-all endpoints (`POST /api/feeds/{id}/read-all`, `/api/folders/{id}/read-all`, `/api/feed-items/read-all`, `/api/saved-pages/read-all`) require JSON `{ before: <uuidv7> }`, bounded decoding; missing/invalid → 400; SQL adds `AND id <= ?`. Extend `TestQueryPlansUseIndexes` for list/count/read-all in all four scopes.

### D. Count refresh (frontend)
1. Heading and sidebar share existing selectors; optimistic ±1 only from A2/A3.
2. Queue epoch increments on every enqueued intent (incl. coalesced and barriers). Keep the existing sidebar refresh owner (`sidebar.ts`, four GETs, owner identity check). A count result is applied only if the queue was idle at dispatch and the epoch is unchanged; a rejected round records one deferred refresh that runs on drain (no immediate rerun loop). Owner's immediate rerun stays for non-queue invalidations. No per-source sequence counters.
3. Triggers: queue drain, periodic 60 s (skipped while queue non-empty, paused while hidden, immediate on visible, applied refresh resets timer), existing invalidations (saved-page add/delete, etc.). Timers/owners invalidated on logout/401. Lists are never auto-reloaded.

### E. Spec, docs, tests
- Spec: CM-PAGE-1 (boundary), LIB-READ-1 (mark-all pessimistic + indicator), LIB-READ-2 (boundary definition, sidebar fallback, folder membership at execution), page-one reload triggers incl. mark-all success, polling rule, endpoint tables (feeds.md, folders.md, later.md) incl. count shapes; replace the failed-mark-all rollback scenario; reader-spec SKILL.md quick-action rule names mark-all as the pessimistic exception; engineering skill queue description.
- Update tests: `internal/http/feeds_test.go` (bodyless read-all, count shape), `internal/http/saved_pages_test.go`, `internal/http/paging_test.go` (cursor-only success), `web/src/api/feeds.ts`/`client.ts`/`decoders.ts`, `web/test/api-decoders.test.ts`, `web/test/api-shapes.test.ts`, `web/test/support/app-harness.ts`, state-read-sync and sidebar refresh race tests.
- New tests: same-boundary continuation, empty page, cursor-without-boundary 400, bounded counts, coalescing, barrier ordering (unread toggle before/after mark-all, failed toggle after mark-all, GET after a later toggle settled), first-click count fetch + failure, superseded filter/order response, drain/visibility/periodic refresh, logout cleanup, VirtualList measurement offsets after prepend/remove.

## Next steps
1. Optional: one more independent plan review of revision 4 (user was offered; recommendation was to skip and rely on code review).
2. Implement per `task-model-routing`: backend first (C2–C6 + Go tests), then frontend in disjoint-ownership tasks (queue/state, mark-all + reader refresh, counts/refresh owner + polling, API decoders/tests), then spec/docs.
3. Independent code review with F-contracts (A2, A5, B1, B2, B4, D2) as focus; fix; browser verification.
4. Verification: `go test ./...`, `go vet ./...`, `go tool golangci-lint run ./...`, `pnpm --dir web check`, `pnpm --dir web test`, `pnpm --dir web build`, browser check.
