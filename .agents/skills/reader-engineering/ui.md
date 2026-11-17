---
name: reader-ui
description: Conditional file of the reader-engineering skill. Read when touching styling, layout, shared controls in apps/reader/src/web/ui, focus handling, icons, the article iframe, or when verifying the UI in a browser.
---

# UI

This file is the visual system and the shared controls: how the app looks and lays out, what each reusable control guarantees, how focus survives a responsive change, how article HTML stays isolated, and how a UI change is verified. What each screen offers and does — menu contents, list reloading, dialog flows, settings fields, read marking — is a rule of `reader-spec` and is not repeated here. Class names and dimensions are in the source; the rules below say what may not drift.

## Layout mechanics

- Wide screens use three columns: sidebar, article list, reader. Intermediate screens keep the sidebar and show either the list or the reader. Small screens show one panel plus a mobile navigation bar. This panel layout's whole responsive behaviour is CSS (Tailwind breakpoints), not scripted layout. The settings page is the one exception: it chooses sidebar-beside-sections versus stacked sections by measuring the available space, not by a breakpoint (`reader-spec/settings.md`).
- Hiding a panel must not lose focus: when a panel becomes hidden, move focus from the actual visibility and the actual focused element, not from a JavaScript media query that mirrors a CSS breakpoint — the two disagree at the edges and after zoom. Keep valid focus and an open dialog untouched.
- The article-list heading is one compact row: title and unread count grouped on the left, icon-sized actions on the right. No action row is added below it.
- Article rows are content-sized with full-width hover and selected surfaces; a title is clamped to three lines and a summary to two. The unread control sits inside the row's hit area but is its own target, so pressing it never activates the article link.
- List titles carry no hover underline; hover feedback is the full-width surface only.

## Visual system

- Dark neutral surfaces, purple interactive and selected accents, and one warm brand accent. Everything comes from the daisyUI theme and Tailwind tokens; no invented colors.
- `index.css` is the only stylesheet: `@import "tailwindcss"`, one `@theme` block, and the daisyUI plugin. The daisyUI theme is named `blackwhite`, is the default, and sets `color-scheme: dark` with these tokens:

| Token | Value |
| --- | --- |
| `--color-base-100` / `-200` / `-300` | `#1e1e1e` / `#252525` / `#343434` |
| `--color-base-content` | `#dddddf` |
| `--color-primary` / `--color-primary-content` | `#c9afe9` / `#20172b` |
| `--color-error` / `--color-error-content` | `#f28b82` / `#2b1110` |
| `--color-neutral` / `--color-neutral-content` | `#5e4774` / `#f2eafa` |
| `--radius-box` / `--radius-field` / `--radius-selector` | `0.5rem` / `0.3rem` / `0.3rem` |
| `--border` / `--depth` / `--noise` | `1px` / `0` / `0` |

- The warm brand accent is the Tailwind token `--color-brand: #d5a15c` in the `@theme` block, used as `text-brand` / `bg-brand`. A color defined only in the daisyUI theme block produces no utility class: any custom semantic color must also be registered with Tailwind `@theme`.
- Use Tailwind for all presentation a utility expresses. `index.css` stays Tailwind/daisyUI configuration and theme tokens: no component CSS, no `@apply`, no giant class constants, no sprawling descendant selectors. When a repeated piece of UI needs a shared look, extract a component in `ui/`.
- Prefer the built-in sizing, spacing and breakpoint scales over incidental precision. Unavoidable fixed dimensions are in `rem`, except thin borders in `px`. The only runtime CSS values are measured: the article frame's height and `VirtualList`'s layout values (row offsets, total height).

## Shared controls (`src/web/ui`)

Domain-free components; data arrives through props.

- **`Button`** is the only component that renders a native `<button>`. Ordinary buttons share rounded-rectangle geometry, a pale hover background and a soft shadow. A filled daisyUI button uses the solid variant so the semantic background/content and their hover colors survive; the submit button supplies that variant. Preserve sizes, selected and destructive states, loading state, refs, labels and ARIA attributes; a filled selected surface keeps its look on hover. Icon targets on touch are 44px. The one deliberate exception is the article read-status toggle, whose hit area is circular.
- **`Input`** is the only text-field base; a labeled, validated field composes it through `FormField`. Keep idle borders and backgrounds visible, keep native attributes and Solid prop reactivity, and style the invalid-and-focused state as well as ordinary focus. Checkboxes stay native in semantics: a menu toggle composes `MenuCheckbox`, never `Input`.
- **`Dialog`** is the shared controlled native dialog: its `open` prop drives `showModal()` / `close()`, and native close events notify the owner. Esc, the close button and focus return to the invoker are part of the control, so a screen that composes it inherits them; the invoking popover is closed before the dialog opens. Which dialog exists on which screen, and what it does on success or failure, is `reader-spec`.
- **`MenuCheckbox`** keeps a native checkbox visually hidden and renders the `Icon` square / squareCheck visuals. Match size, the purple selected color, disabled feedback and keyboard focus. Never substitute a browser-styled checkbox or an unrelated selected icon.
- **`Icon`** is one SVG map: reuse it instead of adding an icon dependency, and add to the map when a glyph is missing. Its default size is `size-5`; an explicit `class` must include the intended size or the icon loses it. Read status is drawn from two glyphs only: read is an empty ring, unread is an outer ring with a smaller solid center separated by a transparent gap.
- **`VirtualList`** measures rows after mount, when `data-index` and the row's children exist, and keeps the virtualizer's resize tracking. Diagnose measurement and index timing before changing estimates or clipping overflow to hide an overlap.

## Article isolation

- Article HTML is rendered only inside `ArticleFrame`'s sandboxed iframe, from `srcdoc`; it never enters the app document. Sharing the app's compiled Tailwind stylesheet with that frame is what makes an article readable, and it must not weaken the isolation below.
- The sandbox is `allow-scripts allow-popups allow-popups-to-escape-sandbox` — deliberately without `allow-same-origin`, so the frame keeps an opaque origin. Scripts are needed for the resize reporter; popups are needed so external links leave the frame.
- The frame's document carries a CSP meta tag: `default-src 'none'`, `img-src https: http:`, `style-src 'unsafe-inline'` plus the app origin (the linked stylesheet), `script-src 'nonce-<nonce>'`, `base-uri 'none'`, `form-action 'none'`, and a `no-referrer` referrer policy. The stylesheet link is the only external resource; in development it is requested with `?direct` so Vite serves the raw CSS instead of the JS module.
- Every mount generates two secrets from `crypto.getRandomValues`: the CSP nonce for the inline reporter script and a separate token for resize messages. A new frame gets new values, so a token from an earlier mount is useless.
- The reporter posts `{ type: 'article-frame-resize', token, height }`. The parent accepts a message only when `event.source` is that iframe's own window, the type is known, the token equals the current mount's token and the height is a finite number in a sane range; nothing else may change layout. The measured height is applied as a custom property in `rem`, with `scrolling="auto"` until the first measurement.
- Sanitized article HTML arrives with its own classes stripped and a fixed per-element class map reapplied, because the stored HTML carries no styling of the app. That map is the single place article typography lives.
- The embedded-page frame is a different component and a different risk: it loads the third-party site's URL (http or https, no credentials, never the app's own origin) with `allow-same-origin`, because it is a foreign page, not article HTML. Do not merge the two frames.

## Verification

- Verify the states the change touches — hover, focus, selected, disabled — in a real browser. Full-width list surfaces must contain the unread-button hit area, and the unread control must not activate the article link.
- Check title/count alignment, long titles, and the narrow and coarse-pointer viewports at their actual sizes; confirm the real viewport dimensions before claiming mobile verification.
- For the article frame, check that the stylesheet loads inside the frame, that typography matches, that the measured height leaves neither a scrollbar nor clipped text, and that a resized window is re-measured.
- Run the repository's check/typecheck/test/build. Node/Vitest tests cover state; they do not establish visual acceptance. If the available browser renders only the app shell or lacks CJK glyphs, report that limitation instead of claiming visual verification.
