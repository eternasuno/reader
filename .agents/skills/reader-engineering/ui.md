---
name: reader-ui
description: Conditional file of reader-engineering. Read when modifying styling, layout, shared controls, focus handling, or the article iframe in web/.
---

# UI (`web/`)

## Layout & Focus

- **Responsive panels** (pure CSS breakpoints, never JS media queries): wide = 3 columns (`sidebar | list | reader`); medium = `sidebar | (list or reader)`; narrow = single active panel, with the drawer toggle inside the list heading (no separate top bar). Narrow icon buttons use `max-md:size-10`; touch-only affordances use `pointer-coarse:`; root containers pad `env(safe-area-inset-*)` (`viewport-fit=cover`); dialogs become bottom sheets and toasts span the bottom below `sm`. Icon's svg always carries `inline-block`, so responsive show/hide classes go on a wrapping element, never on `<Icon>` itself. When CSS hides a panel containing `document.activeElement`, move focus to the visible panel based on actual element visibility (`offsetParent` / computed visibility).
- **Article list**: virtualized via a thin Solid 2 `VirtualList` wrapper around framework-agnostic `@tanstack/virtual-core` (using `onSettled` + `createEffect` to measure row heights after mount); heading is a single compact row (title + plain count left, icon actions right) whose height matches the reader toolbar (`min-h-13`).
- **Selection & rows**: selected sidebar rows and article cards use `bg-neutral text-neutral-content`; hover uses `bg-base-200`. Content inside selectable rows dims with `opacity-*` (not `text-base-content/*`) so it inherits the selected text color. Counts are plain `text-xs tabular-nums opacity-60`, never badges. Article rows are `rounded-box` cards without dividers; group headings (sidebar `订阅源`, settings groups) use `text-xs font-semibold tracking-wider uppercase text-base-content/50`; dialogs have no header/footer dividers and use `btn-sm` actions; empty states use a 40px `opacity-30` icon + `text-base` title + `text-sm` hint; thumbnails and site icons (`SiteIcon`) render `loading="lazy" referrerpolicy="no-referrer"` and are keyed by URL so reused virtual rows retry after a failure.

## Visual System

- Tailwind CSS 4 + daisyUI 5 dark theme `blackwhite` (`color-scheme: dark`), plus custom `@theme` token `--color-brand: #d5a15c`:
  - `--color-base-100 / -200 / -300`: `#1e1e1e / #252525 / #343434`
  - `--color-base-content`: `#dddddf`
  - `--color-primary / -content`: `#c9afe9 / #20172b` (primary actions only)
  - `--color-secondary / -content`: `#3a3a3c / #e5e5e7` (muted secondary actions: retry, empty-state, settings actions)
  - `--color-error / -content`: `#f28b82 / #2b1110`
  - `--color-neutral / -content`: `#5e4774 / #f2eafa`
- Keep `index.css` strictly to `@import "tailwindcss"`, `@theme`, and daisyUI config (no `@apply` or component CSS). Shared primitives (`Button`, `Input`, `Dialog`, `MenuCheckbox`, `MenuRadio`, `Icon`, `VirtualList`, `SettingsGroup` / `SettingsRow` / `StatusBadge`) live in `web/src/ui/` and carry no domain imports.
- Disabled controls must stay legible: daisyUI's default disabled radio/checkbox `opacity: 0.2` is near-invisible on this theme, so use `disabled:opacity-100 disabled:border-base-content/30` on the input and `has-[:disabled]:` utilities on the label. Gated options (e.g. `browser` provider without an endpoint) show a hint plus a link to the section that unlocks them.

## Article Isolation (`ArticleFrame`)

- Render sanitized article HTML inside `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcdoc="...">` (deliberately omitting `allow-same-origin`).
- Apply CSP `<meta>` inside `srcdoc`: `default-src 'none'; img-src https: http:; style-src 'unsafe-inline' <origin>; script-src 'nonce-<nonce>'; base-uri 'none'; form-action 'none'` with `referrerpolicy="no-referrer"`.
- Link the app's compiled stylesheet into `srcdoc`, strip source classes from stored HTML, apply fixed reader typography classes by tag, and set an explicit sans stack with Latin fonts before CJK fonts (avoid bare `system-ui` fallback quirks on Linux, and full-width CJK glyphs for `’` / `“` in English text). The frame body has no horizontal padding so text aligns with the reader header.
- Generate a fresh CSP nonce and `postMessage` resize token per render; accept `{ type: 'article-frame-resize', token, height }` only when `event.source === iframe.contentWindow`, token matches, and `1 <= height <= 1_000_000`.
- Keep the embedded external-page frame (`RD-WEBPAGE-1`, with `allow-same-origin`) as a separate component; never merge it with `ArticleFrame`.

## Verification

Verify visual changes in a real browser (Vitest client-posture tests only cover store/action state): hover/focus/selected surfaces, unread-button hit isolation, narrow/touch viewports, stylesheet loading inside `ArticleFrame`, and resize re-measurement.
