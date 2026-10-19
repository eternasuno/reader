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

## UI Styling and Focus

- Use Tailwind for all expressible presentation; keep `index.css` limited to Tailwind/daisyUI configuration and theme tokens. Do not reintroduce component CSS, `@apply`, giant class constants, or sprawling descendant selectors; simplify utilities and extract cohesive repeated UI components.
- Prefer built-in sizing and breakpoint scales over incidental precision. Necessary custom fixed dimensions use rem except thin borders. Dynamic iframe height and generated anchor names may be passed as runtime CSS values.
- All buttons compose `components/atoms/button.tsx`; only that base component renders the native button. `IconButton`, navigation buttons, and submit buttons retain specialized semantics but share rounded-rectangle geometry and a pale hover background with a soft shadow. Do not reintroduce circular hover surfaces or independent button hover implementations. Preserve sizes, selected/primary/destructive states, native form behavior, refs, labels, and disabled/loading behavior.
- List titles have no hover underline; use the full-width list surface for hover feedback. Keep the open-original action in the overflow menu, not the reader toolbar.
- Keep responsive layout in Tailwind. Recover focus from actual visibility and current focus, not JavaScript media queries mirroring CSS breakpoints; preserve valid focus and open dialogs.
- Keep article content isolated inside its sandboxed iframe. Sharing compiled Tailwind must preserve CSP, sandboxing, content isolation, and resize-message authentication; verify stylesheet loading and typography in a real browser.
- Verify relevant hover, focus, selected, and disabled states. Full-width list surfaces must contain unread-button hit areas, and unread controls must not activate article links. Confirm actual browser viewport dimensions before claiming mobile verification.

## Solid Session Subscription

Create the browser auth client with `createAuthClient` from `better-auth/solid`. Call `authClient.useSession()` inside the component's owned scope and read its returned accessor directly. The official adapter owns reactive updates and subscription cleanup; do not implement a separate signal or subscription bridge.

## Deployment Topology

- Keep build-time workspace structure separate from the assembled runtime. Do not require pnpm, Turbo, development dependencies, or workspace-relative asset paths in the runtime image.
- Static routes are always mounted through a single `HttpStaticServer.layer` with fixed root `public`; absence during development does not require an environment branch or startup filesystem check.
- Internal workspace packages may export TypeScript source. Do not enable package injection or add `ssr.noExternal` without a concrete need; verify API bundling does not leave runtime imports of source-only packages when introducing them.

When deployment topology, startup procedure, or the web/API runtime relationship needs confirmation, first read the relevant section of `README.md`; do not duplicate changing lists or defaults in this skill.
