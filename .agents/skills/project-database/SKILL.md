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

Business contracts and layout below describe the rewrite target in `docs/`, not the current implementation. Before changing existing code, read `docs/README.md` (especially "The current code") and the relevant `docs/usecases` spec.

- Lists use database-side keyset paging on `id` descending, always scoped by owner, filtered by `unreadOnly` in both lists and by `feedId` for feed items: the cursor is the `id` of the last returned row and the next page is the rows with a smaller id. `publishedAt` is display-only and belongs in no `ORDER BY`, keyset clause or index. Keep the keyset clause builder in one place, and confirm with `EXPLAIN` that the `id` bound narrows the index scan instead of filtering from the head of the index.
- Unique URL indexes enforce duplicates: `(owner, url)` for feeds and saved pages, `(feed, url)` for feed items. The saved-page `findByUrl` check before fetching only avoids wasted work; `create` relies on the index, so a concurrent create of the same URL leaves exactly one row. The port contract and the duplicate rules live in `docs/usecases/common.md` CM-PORT and the domain specs; do not restate them here.
- Choose indexes from the target queries and verify each with `EXPLAIN`: the owner-scoped lists by `id`, the feed-item list filtered by `feedId`, the unread filter, the grouped unread counts, and each unique URL index. Include `owner` in every owner-scoped index now that queries are owner-scoped instead of assuming a personal deployment; feed-scoped indexes carry `feed`.
- Re-check `EXPLAIN` with the real store SQL after changing paging or indexes. Existing measurements predate the `id` order and do not carry over.

When database environment variables, deployment topology, or startup procedure needs confirmation, first read the relevant section of `README.md`; do not duplicate environment defaults or deployment lists in this skill.
