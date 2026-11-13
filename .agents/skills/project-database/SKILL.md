---
name: project-database
description: Follow the startup, query, and migration boundaries when working on this repository's SurrealDB/SurrealKV runtime connections, queries, Better Auth schema migrations, or database deployment configuration.
---

# Project Database

- At API startup, connect only to the configured SurrealDB/SurrealKV and select the namespace/database; do not generate or apply schema at runtime.
- Apply both the exported Better Auth DDL and reader-store schema through the project's existing `db:migrate` entry point.
- Normalize SurrealDB `NONE` results at the store boundary before domain decoding: selected fields can be present with value `undefined`. Remove those keys so Effect HTTP JSON encoding omits optional fields instead of producing `null`, which browser schemas reject.
- Apply the migration once during deployment, then start the service; do not put migrations into runtime startup, which can cause contention when multiple instances restart.
- Bind query values as parameters, including `LIMIT $limit`. Do not interpolate a value into SQL without a specific reason, even an internal numeric one, because later edits can route untrusted input there; interpolate only constant fragments such as fixed clauses and column names. On SurrealDB 4.0 binding `LIMIT` showed no meaningful speed difference from a literal.
- The project is in development: do not write data migrations or compatibility paths for stored data. The embedded engine's major version fixes the SurrealKV on-disk format (`@surrealdb/node` 3.2 embeds SurrealDB 4.0 and refuses directories written by 3.x). When a schema or engine change breaks existing data, delete the database directory and run `db:migrate` again.

The repository contracts the stores implement (owner scoping, paging, unique URLs, intent-named writes, cascades) are in the `project-business` skill: `common.md` CM-OWN, CM-PAGE and CM-PORT, plus the port tables of its domain files.

- Lists use database-side keyset paging on `id` descending, always scoped by owner, filtered by `unreadOnly` in both lists and, for feed items, by `feedId` (`listByFeed`) or by the feeds whose `folderId` is the folder (`listByFolder`): the cursor is the `id` of the last returned row and the next page is the rows with a smaller id. `publishedAt` is display-only and belongs in no `ORDER BY`, keyset clause or index. Keep the keyset clause builder in one place, and confirm with `EXPLAIN` that the `id` bound narrows the index scan instead of filtering from the head of the index.
- Unique indexes enforce duplicates: `(owner, url)` for feeds and saved pages, `(feed, url)` for feed items, `(owner, name)` for folders (case-sensitive). The saved-page `findByUrl` check before fetching only avoids wasted work; `create` relies on the index, so a concurrent create of the same URL leaves exactly one row. The port contract and the duplicate rules live in the `project-business` skill (CM-PORT and the domain files); do not restate them here.
- Choose indexes from the target queries and verify each with `EXPLAIN`: the owner-scoped lists by `id`, the feed-item list filtered by `feedId` or by folder, the feeds of a folder (`(owner, folderId)` on `feed`), the unread filter, the grouped unread counts, and each unique index. Include `owner` in every owner-scoped index now that queries are owner-scoped instead of assuming a personal deployment; feed-scoped indexes carry `feed`.
- Re-check `EXPLAIN` with the real store SQL after changing paging or indexes. Existing measurements predate the `id` order and do not carry over.
- Every write of the feed, folder, feed-item and saved-page stores takes the one-permit semaphore `ReaderStoreConcurrency` (`apps/api/src/store/index.ts`), so those writes run one at a time per process, and `run` in `store/sql.ts` makes each statement uninterruptible; reads and the setting store are outside the lock. The lock arrived with the first SurrealDB store (commit `3da56a8`) and its reason was not recorded; the presumed reason is write-transaction conflicts in the embedded engine when several feed syncs write at once. Treat it as unverified: issue #10 tracks measuring the latency of a user write (mark read) while a few hundred feeds refresh, and only that measurement decides whether the lock stays, narrows or goes.

When database environment variables, deployment topology, or startup procedure needs confirmation, first read the relevant section of `README.md`; do not duplicate environment defaults or deployment lists in this skill.
