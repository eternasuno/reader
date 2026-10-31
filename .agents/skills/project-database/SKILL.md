---
name: project-database
description: Follow the startup and migration boundaries when working on this repository's SurrealDB/SurrealKV runtime connections, Better Auth schema migrations, or database deployment configuration.
---

# Project Database

- At API startup, connect only to the configured SurrealDB/SurrealKV and select the namespace/database; do not generate or apply schema at runtime.
- Apply both the exported Better Auth DDL and reader-store schema through the project's existing `db:migrate` entry point.
- Normalize SurrealDB `NONE` results at the store boundary before domain decoding: selected fields can be present with value `undefined`. Remove those keys so Effect HTTP JSON encoding omits optional fields instead of producing `null`, which browser schemas reject.
- Apply the migration once during deployment, then start the service; do not put migrations into runtime startup, which can cause contention when multiple instances restart.

When database environment variables, deployment topology, or startup procedure needs confirmation, first read the relevant section of `README.md`; do not duplicate environment defaults or deployment lists in this skill.
