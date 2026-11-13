---
name: project-architecture
description: Follow the client architecture and resource-lifecycle constraints when working on this repository's SolidJS pages, browser/API boundary, frontend session subscriptions, or deployment topology.
---

# Project Architecture

- Inspect the relevant source and configuration before making changes. Prefer existing responsibilities and capabilities, and make only the minimum change required by the task.
- The project is a pure client-side SolidJS 1 SPA with a separate Effect HttpServer API; the browser accesses the API through credentialed HTTP requests.
- Keep `apps/web` limited to browser routes, components, the Better Auth client, and the API client; preserve client rendering.
- Do not introduce `apps/api`, Effect server modules, database clients, embedded engines, secrets, or Better Auth server configuration into web; do not add SSR or server functions.
- Server code is grouped by responsibility under `apps/api/src`: HTTP handlers and middleware in `http/`, repository implementations in `store/`, feed parsing, HTML parsing, extraction and sanitizing in `content/`, the refresh queue and scheduler in `refresh/`, Better Auth in `auth.ts`, the database connection in `db/`; see the `project-effect-api` skill. Do not move any of it into web.

- Use `type` aliases for ordinary TypeScript data shapes and contracts instead of hand-written JavaScript classes; the rule targets native object-oriented style only. Class forms that Effect provides are allowed and preserved, such as `Context.Service`, `Schema.Class`, `Model.Class` and `Data.TaggedError`. The one exception is the shape of an Effect service: declare it as `interface I<Service>` next to its `Context.Service` class (ports in `packages/business/src/port/`, `IFeedRefreshQueue` in `apps/api`), and keep every such shape an `interface`, not a `type`.
- Keep shared Effect language-service settings in the root `tsconfig.json`; let app configs inherit them rather than duplicate the plugin array. Use app overrides only for genuinely app-specific settings. Its `allowedUnstableApis` lists the unstable APIs the code may use: Effect tags modules and exports `@stability unstable` inside `effect` as well as in other packages, and an unlisted one makes `pnpm typecheck` exit non-zero. Allow whole modules or packages rather than individual exports (`effect/http`, `effect/http-api`, `@effect/platform-node`, `@effect/vitest`; the business rewrite adds `effect/schema/Model`).

## Web layers

`apps/web/src` is split into `api/`, `models/`, `components/` (`atoms`, `molecules`, `organisms`, `templates`) and `pages/`. Imports point one way only; check every new import against this:

```text
pages → templates → organisms → molecules → atoms
organisms, pages → models → api
```

- `api/` owns the HTTP client derived from the `@reader/api` contract with Effect's HTTP API client, the Better Auth client (`api/auth.ts`), and the one table from contract error `_tag` to user-visible wording. Every request goes through the derived client: no hand-written path, method, payload shape or response schema anywhere in web. `api/` imports no Solid API or router hook, handles no `FormData` and performs no navigation.
- `models/<feature>/` (`models/library/`, `models/settings/`) owns state and logic. State and logic never live in `pages/`.
- `components/atoms/` and `components/molecules/` carry no domain: they do not import `api/`, `models/` or the auth client, and receive their data through props. A component that knows the business is an organism, under `components/organisms/<feature>/` (`library/`, `settings/`, `auth/`). `components/templates/` hold page layouts and take their content through props.
- `pages/` only check the session, take the model and hand data to a template. No file under `components/` imports `pages/`.
- Reload a list by listing again from the first page with no cursor: no polling, no refresh-through request, and no in-place merge of rows. Fetch feed unread counts and the saved-page unread count from their separate endpoints.
- Components and pages own presentation, native form validation, conversion from `FormData` to model parameters, submission state, and navigation.
- `api/auth.ts` initializes the single official Better Auth Solid client and exports authentication operations using that client directly. Adapter initialization and inferred session types are allowed here; invoke reactive hooks only in the presentation layer.

## UI Styling and Focus

When changing reader layout, sidebar/list menus, list reloading and read state, article modes, subscribe and add-link flows, the settings page, or shared menu/status icons, read [Reader layout and interactions](reader-ui.md). It records the agreed control placement, scope behavior, and state transitions; preserve these unless the current user request changes them.

When changing or verifying folder (`目录`) behavior — sidebar folder rows and collapse, the folder scope, folder and move dialogs, or choosing a folder when subscribing — also read [Folder acceptance scenarios](feed-folders.feature). Each Gherkin scenario is an acceptance case; change the scenario in the same change as the behavior it fixes.

- Use Tailwind for all expressible presentation; keep `index.css` limited to Tailwind/daisyUI configuration and theme tokens. Do not reintroduce component CSS, `@apply`, giant class constants, or sprawling descendant selectors; simplify utilities and extract cohesive repeated UI components.
- Prefer built-in sizing and breakpoint scales over incidental precision. Necessary custom fixed dimensions use rem except thin borders. Dynamic iframe height and generated anchor names may be passed as runtime CSS values.
- All buttons compose `components/atoms/button.tsx`; only that base component renders the native button. Ordinary buttons share rounded-rectangle geometry, a pale hover background, and a soft shadow. Filled daisyUI buttons use `variant="solid"` to retain semantic background/content and hover colors; `SubmitButton` supplies this variant. The article read-status toggle is the intentional circular-hit-area exception. Preserve sizes, selected/destructive states, native form behavior, refs, labels, and disabled/loading behavior; do not duplicate hover implementations at call sites.
- Text inputs compose `components/atoms/input.tsx`; labeled validated fields use `FormInput`. Keep idle borders and backgrounds visible, preserve native attributes and Solid prop reactivity, and verify invalid + focused styling as well as ordinary focus. Keep checkbox semantics native: menu toggles compose `MenuCheckbox`, not the text-input atom.
- Settings, subscription, and add-link dialogs compose `components/molecules/dialog.tsx`. Its controlled `open` prop drives native `showModal()`/`close()`; native close events notify the owner. Preserve Esc, close-button and focus-return behavior. Add-link submission closes on success and remains open on failure.
- Reuse the `ReaderIcon` SVG map rather than adding an icon dependency for existing coverage. Its default size is `size-5`; an explicit `class` must include the intended size. Custom semantic utility colors must be registered with Tailwind `@theme`, not only the daisyUI theme.
- List titles have no hover underline; use the full-width list surface for hover feedback. Keep article rows content-sized with titles clamped to three lines, summaries to two, and fixed thumbnail dimensions. In `VirtualScroller`, measure rows after mount, when `data-index` and children exist; retain the virtualizer's resize tracking. Diagnose measurement/index timing before changing estimates or clipping overflow to hide overlap. Keep the open-original action in the overflow menu, not the reader toolbar.
- Keep responsive layout in Tailwind. Recover focus from actual visibility and current focus, not JavaScript media queries mirroring CSS breakpoints; preserve valid focus and open dialogs.
- Keep article content isolated inside its sandboxed iframe. Sharing compiled Tailwind must preserve CSP, sandboxing, content isolation, and resize-message authentication; verify stylesheet loading and typography in a real browser.
- Verify relevant hover, focus, selected, and disabled states. Full-width list surfaces must contain unread-button hit areas, and unread controls must not activate article links. Confirm actual browser viewport dimensions before claiming mobile verification.

## Accounts

- Accounts are Better Auth email/password accounts; its defaults decide password rules (8 to 128 characters). Registration does not sign in: show errors for a taken email or a short password, otherwise go to the login page. Signing in with the right credentials opens the library; wrong credentials show an error and stay on the login page.
- `/`, `/rss` and `/settings` need a session and redirect to the login page without one. Signing out ends the session and goes to the login page. Changing the password needs the current password: on success the new password is the one to sign in with; a wrong current password changes nothing and shows an error.
- There is no password recovery, email verification, or account deletion.

## Solid Session Subscription

Create the browser auth client with `createAuthClient` from `better-auth/solid`. Call `authClient.useSession()` inside the component's owned scope and read its returned accessor directly. The official adapter owns reactive updates and subscription cleanup; do not implement a separate signal or subscription bridge.

## Deployment Topology

- Keep build-time workspace structure separate from the assembled runtime. Do not require pnpm, Turbo, development dependencies, or workspace-relative asset paths in the runtime image.
- Static routes are always mounted through a single `HttpStaticServer.layer` with fixed root `public`; absence during development does not require an environment branch or startup filesystem check.
- Internal workspace packages may export TypeScript source. Do not enable package injection or add `ssr.noExternal` without a concrete need; verify API bundling does not leave runtime imports of source-only packages when introducing them.

When deployment topology, startup procedure, or the web/API runtime relationship needs confirmation, first read the relevant section of `README.md`; do not duplicate changing lists or defaults in this skill.
