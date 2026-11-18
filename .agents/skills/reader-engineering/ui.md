---
name: reader-ui
description: Conditional file of reader-engineering. Read when modifying styling, layout, shared controls, focus handling, or the article iframe in web/.
---

# UI (`web/`)

## Layout & Focus

- **Responsive panels** (pure CSS breakpoints, never JS media queries): wide = 3 columns (`sidebar | list | reader`); medium = `sidebar | (list or reader)`; narrow = single active panel + mobile top bar. When CSS hides a panel containing `document.activeElement`, move focus to the visible panel based on actual element visibility (`offsetParent` / computed visibility).
- **Article list**: virtualized via a thin Solid 2 `VirtualList` wrapper around framework-agnostic `@tanstack/virtual-core` (using `onSettled` + `createEffect` to measure row heights after mount); heading is a single compact row (title + count left, icon actions right).

## Visual System

- Tailwind CSS 4 + daisyUI 5 dark theme `blackwhite` (`color-scheme: dark`), plus custom `@theme` token `--color-brand: #d5a15c`:
  - `--color-base-100 / -200 / -300`: `#1e1e1e / #252525 / #343434`
  - `--color-base-content`: `#dddddf`
  - `--color-primary / -content`: `#c9afe9 / #20172b`
  - `--color-error / -content`: `#f28b82 / #2b1110`
  - `--color-neutral / -content`: `#5e4774 / #f2eafa`
- Keep `index.css` strictly to `@import "tailwindcss"`, `@theme`, and daisyUI config (no `@apply` or component CSS). Shared primitives (`Button`, `Input`, `Dialog`, `MenuCheckbox`, `MenuRadio`, `Icon`, `VirtualList`) live in `web/src/ui/` and carry no domain imports.

## Article Isolation (`ArticleFrame`)

- Render sanitized article HTML inside `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcdoc="...">` (deliberately omitting `allow-same-origin`).
- Apply CSP `<meta>` inside `srcdoc`: `default-src 'none'; img-src https: http:; style-src 'unsafe-inline' <origin>; script-src 'nonce-<nonce>'; base-uri 'none'; form-action 'none'` with `referrerpolicy="no-referrer"`.
- Link the app's compiled stylesheet into `srcdoc`, strip source classes from stored HTML, apply fixed reader typography classes by tag, and set an explicit `font-sans` stack (avoid bare `system-ui` fallback quirks on Linux).
- Generate a fresh CSP nonce and `postMessage` resize token per render; accept `{ type: 'article-frame-resize', token, height }` only when `event.source === iframe.contentWindow`, token matches, and `1 <= height <= 1_000_000`.
- Keep the embedded external-page frame (`RD-WEBPAGE-1`, with `allow-same-origin`) as a separate component; never merge it with `ArticleFrame`.

## Verification

Verify visual changes in a real browser (Vitest client-posture tests only cover store/action state): hover/focus/selected surfaces, unread-button hit isolation, narrow/touch viewports, stylesheet loading inside `ArticleFrame`, and resize re-measurement.
