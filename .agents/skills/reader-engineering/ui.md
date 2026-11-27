---
name: reader-ui
description: Conditional file of reader-engineering. Read when modifying styling, layout, shared controls, focus handling, or article body rendering in web/.
---

# UI (`web/`)

## Layout & Focus

- **Responsive panels** (pure CSS breakpoints, never JS media queries): wide = 3 columns (`sidebar | list | reader`); medium = `sidebar | (list or reader)`; narrow = single active panel, with the drawer toggle inside the list heading (no separate top bar). Desktop (`md+`) sidebar collapse state persists in `localStorage` (`reader.sidebarCollapsed`), collapsing the sidebar grid track to `0rem` while keeping the panel mounted with `inert`/`aria-hidden` and fixed inner `min-w-*` so `grid-template-columns` animates without text reflow; below `md`, the drawer and backdrop stay mounted and transition via `max-md:` transform/opacity classes. Narrow icon buttons use `max-md:size-10`; touch devices get a global scale from `html { font-size: 112.5% }` under `@media (pointer: coarse)` in `index.css`, so sizes must stay `rem`-based (`Icon` sets its width/height in `rem`) and controls never carry per-element `pointer-coarse:size-*` enlargement; `pointer-coarse:` is only for touch-only affordances (e.g. the always-visible read circle); root containers pad `env(safe-area-inset-*)` (`viewport-fit=cover`); dialogs become bottom sheets and toasts span the bottom below `sm`. Icon's svg always carries `inline-block`, so responsive show/hide classes go on a wrapping element, never on `<Icon>` itself. When CSS hides a panel containing `document.activeElement`, move focus to the visible panel based on actual element visibility (computed `display`/`visibility` and `inert` ancestors).
- **Article list**: virtualized via a thin Solid 2 `VirtualList` wrapper around framework-agnostic `@tanstack/virtual-core` (using `onSettled` + `createEffect` to measure row heights after mount and auto-scroll when `activeIndex` changes); heading is a single compact row (title + plain count left, icon actions right) whose height matches the reader toolbar (`min-h-13`).
- **Reader**: switching articles resets the reader scroll container to the top (`scrollTop = 0`), while scrolling adds toolbar elevation shadow.
- **Motion**: transitions are short (`180ms`) `motion-safe:animate-fade-in` (keyframes in `@theme` of `index.css`) on article cards, the reader article (keyed by article id so each switch replays it), and expanded folder children. Library scopes are children of one pathless layout route that renders the guarded `LibraryPage` (children render nothing), so switching scope never remounts it or re-verifies the session.
- **Menus & drawers**: list/row/reader menus use in-menu sub-panels (`MenuItem submenu keepOpen`, a back header, then items): `FeedMoveSubpanel` for `移动到`, `FeedReaderModeSubpanel` for a feed's `缺省视图` (feed row, single-feed list, and reader menus), and the reader `视图选项` panel. `ListOrderCheckbox` is the single `从旧到新` control (feed rows use the feed's stored order; every other list uses the shared `reader.listOrder`). Do not reintroduce a feed options drawer, a stored embedded reader mode, a manual refresh item, summary-line/new-tab list options, thumbnails, or an end-of-article next card.
- **Solid 2 writes are batched**: after `setX(...)`, call `flush()` before code that immediately reads `x()` (e.g. before `loadScopeFirstPage` reads the shared order).
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

## Article Body (`ArticleBody`)

- Render server-sanitized article HTML directly via `innerHTML` (no iframe, no re-sanitizing, `CM-ART-2`). Before rendering, parse it with `DOMParser` and strip `class` (source Tailwind classes would match app utilities), `id` / `name` (collisions and DOM clobbering), and `style`; add `referrerpolicy="no-referrer"` to images and `tabindex` / `role="button"` / `aria-label` to unlinked `http(s)` images.
- The page CSP served with `index.html` (`script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' https: http: data:`, `media-src https: http:`, `frame-src https: http:`, `object-src 'none'`, `base-uri 'none'`) is the second defense layer; never add inline `<script>` to `index.html` (the theme bootstrap is `public/theme-init.js`). The page `Referrer-Policy` is `same-origin`, which hides the app URL from image hosts while keeping `Origin` on same-origin POSTs.
- Reader typography lives in `components/articleBody.css`, scoped under `.article-body` (an exception to the `index.css` rule above), reading font size, family, and line height from `--article-*` custom properties set on the container from `readerAppearance()`. Keep Latin fonts before CJK fonts (avoid bare `system-ui` fallback quirks on Linux, and full-width CJK glyphs for `’` / `“` in English text). The body has no horizontal padding so text aligns with the reader header.
- Image clicks and `Enter` / `Space` are delegated on the container and open `ImageLightbox`, which owns `Escape` and focus return.
- Keep the embedded external-page frame (`RD-WEBPAGE-1`, with `allow-same-origin`) as a separate component; never merge it with `ArticleBody`.

## Verification

Verify visual changes in a real browser (Vitest client-posture tests only cover store/action state): hover/focus/selected surfaces, unread-button hit isolation, narrow/touch viewports, and article body typography in both themes.
