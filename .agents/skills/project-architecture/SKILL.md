---
name: project-architecture
description: Follow the client architecture and resource-lifecycle constraints when working on this repository's SolidJS pages, browser/API boundary, frontend session subscriptions, or deployment topology.
---

# Project Architecture

- Inspect the relevant source and configuration before making changes. Prefer existing responsibilities and capabilities, and make only the minimum change required by the task.
- The project is a pure client-side SolidJS 1 SPA with a separate Effect HttpServer API; the browser accesses the API through credentialed HTTP requests.
- Keep `apps/web` limited to browser routes, components, the Better Auth client, and the API client; preserve client rendering.
- Do not introduce `apps/api`, Effect server modules, database clients, embedded engines, secrets, or Better Auth server configuration into web; do not add SSR or server functions.
- API HTTP routes belong in `apps/api/src/routes`, runtime Layers and database capabilities in `apps/api/src/infrastructure`, and request middleware in `apps/api/src/middleware`; place server capabilities according to these responsibilities and do not move them into web.
- Use `type` aliases for ordinary TypeScript data shapes and contracts. Preserve Effect Service classes and runtime classes such as `Data.TaggedError` constructors.
- Keep shared Effect language-service settings in the root `tsconfig.json`; let app configs inherit them rather than duplicate the plugin array. Use app overrides only for genuinely app-specific settings.

## Web Layers

- `apps/web/src/lib` owns ordinary async operations and their parameter types; it must not import Solid APIs or router hooks, handle `FormData`, or perform UI navigation.
- Components and `src/pages` own presentation, native form validation, conversion from `FormData` to logic-layer parameters, submission state, and navigation. Organize components into `atoms`, `molecules`, `organisms`, and `templates`.
- `src/lib/auth.ts` initializes the single official Better Auth Solid client and exports authentication operations using that client directly. Adapter initialization and inferred session types are allowed here; invoke reactive hooks only in the presentation layer.

## Solid Session Subscription

Create the browser auth client with `createAuthClient` from `better-auth/solid`. Call `authClient.useSession()` inside the component's owned scope and read its returned accessor directly. The official adapter owns reactive updates and subscription cleanup; do not implement a separate signal or subscription bridge.

## Deployment Topology

- Keep build-time workspace structure separate from the assembled runtime. Do not require pnpm, Turbo, development dependencies, or workspace-relative asset paths in the runtime image.
- Static routes are always mounted through a single `HttpStaticServer.layer` with fixed root `public`; absence during development does not require an environment branch or startup filesystem check.
- Internal workspace packages may export TypeScript source. Do not enable package injection or add `ssr.noExternal` without a concrete need; verify API bundling does not leave runtime imports of source-only packages when introducing them.

When deployment topology, startup procedure, or the web/API runtime relationship needs confirmation, first read the relevant section of `README.md`; do not duplicate changing lists or defaults in this skill.
