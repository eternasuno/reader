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
- Feed item lists use `feedId IN $feedIds` with database-side keyset paging. SurrealDB plans more than 32 ids as a table scan (upstream surrealdb#7632); this measured acceptable on 4.0 and faster than paging in application code, so re-measure with the real store SQL before changing the approach.

When database environment variables, deployment topology, or startup procedure needs confirmation, first read the relevant section of `README.md`; do not duplicate environment defaults or deployment lists in this skill.
